// Package fundamentals fetches per-ticker company + valuation data from
// Yahoo's quoteSummary endpoint and serves it via /api/v1/quotes/{ticker}/
// fundamentals. Aggressively cached in Redis (24h TTL) — these numbers
// barely change minute-to-minute, and Yahoo rate-limits the unofficial
// quoteSummary endpoint hard.
package fundamentals

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"github.com/stockapp/backend/internal/httpx"
	"github.com/stockapp/backend/internal/price"
)

// Fundamentals is the response shape the UI renders. All fields are
// optional — Yahoo doesn't return every metric for every ticker.
type Fundamentals struct {
	Symbol string `json:"symbol"`

	// Valuation
	MarketCap       *float64 `json:"marketCap,omitempty"`
	TrailingPE      *float64 `json:"trailingPE,omitempty"`
	ForwardPE       *float64 `json:"forwardPE,omitempty"`
	PriceToBook     *float64 `json:"priceToBook,omitempty"`
	EPS             *float64 `json:"eps,omitempty"`
	EnterpriseValue *float64 `json:"enterpriseValue,omitempty"`

	// Performance
	FiftyTwoWeekHigh *float64 `json:"fiftyTwoWeekHigh,omitempty"`
	FiftyTwoWeekLow  *float64 `json:"fiftyTwoWeekLow,omitempty"`
	Beta             *float64 `json:"beta,omitempty"`
	AverageVolume    *int64   `json:"averageVolume,omitempty"`

	// Income / dividends
	DividendYield *float64 `json:"dividendYield,omitempty"` // fraction (0.025 = 2.5%)
	DividendRate  *float64 `json:"dividendRate,omitempty"`  // ₹ per share / year
	PayoutRatio   *float64 `json:"payoutRatio,omitempty"`

	// Profitability
	ProfitMargins  *float64 `json:"profitMargins,omitempty"`
	ReturnOnEquity *float64 `json:"returnOnEquity,omitempty"`
	DebtToEquity   *float64 `json:"debtToEquity,omitempty"`

	// Company
	Sector            string `json:"sector,omitempty"`
	Industry          string `json:"industry,omitempty"`
	FullTimeEmployees *int64 `json:"fullTimeEmployees,omitempty"`
	Description       string `json:"description,omitempty"`
	Website           string `json:"website,omitempty"`

	// Calendar events (upcoming)
	NextEarningsDate *time.Time `json:"nextEarningsDate,omitempty"`
	ExDividendDate   *time.Time `json:"exDividendDate,omitempty"`
	DividendPayDate  *time.Time `json:"dividendPayDate,omitempty"`

	// Income statement (last 4 periods, most-recent first)
	Financials          []YearlyFinancials `json:"financials,omitempty"`
	QuarterlyFinancials []YearlyFinancials `json:"quarterlyFinancials,omitempty"`

	// Balance sheet (last 4 periods, most-recent first)
	BalanceSheets          []BalanceSheetPeriod `json:"balanceSheets,omitempty"`
	QuarterlyBalanceSheets []BalanceSheetPeriod `json:"quarterlyBalanceSheets,omitempty"`

	// Cash flow statement (last 4 periods, most-recent first)
	CashFlows          []CashFlowPeriod `json:"cashFlows,omitempty"`
	QuarterlyCashFlows []CashFlowPeriod `json:"quarterlyCashFlows,omitempty"`

	// Metadata
	Currency  string    `json:"currency,omitempty"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// YearlyFinancials is one period of income-statement data from Yahoo.
// "Yearly" is historical naming — the same struct also represents one
// quarter when we read incomeStatementHistoryQuarterly.
type YearlyFinancials struct {
	Year            int       `json:"year"` // calendar year of the period end
	EndDate         time.Time `json:"endDate"`
	TotalRevenue    *float64  `json:"totalRevenue,omitempty"`
	GrossProfit     *float64  `json:"grossProfit,omitempty"`
	OperatingIncome *float64  `json:"operatingIncome,omitempty"`
	NetIncome       *float64  `json:"netIncome,omitempty"`
	EBITDA          *float64  `json:"ebitda,omitempty"`
}

// BalanceSheetPeriod is one period of balance-sheet data.
type BalanceSheetPeriod struct {
	Year              int       `json:"year"`
	EndDate           time.Time `json:"endDate"`
	TotalAssets       *float64  `json:"totalAssets,omitempty"`
	TotalLiabilities  *float64  `json:"totalLiabilities,omitempty"`
	StockholderEquity *float64  `json:"stockholderEquity,omitempty"`
	LongTermDebt      *float64  `json:"longTermDebt,omitempty"`
	ShortTermDebt     *float64  `json:"shortTermDebt,omitempty"`
	Cash              *float64  `json:"cash,omitempty"`
}

// CashFlowPeriod is one period of cash-flow data.
type CashFlowPeriod struct {
	Year              int       `json:"year"`
	EndDate           time.Time `json:"endDate"`
	OperatingCashFlow *float64  `json:"operatingCashFlow,omitempty"`
	InvestingCashFlow *float64  `json:"investingCashFlow,omitempty"`
	FinancingCashFlow *float64  `json:"financingCashFlow,omitempty"`
	CapEx             *float64  `json:"capEx,omitempty"`
	FreeCashFlow      *float64  `json:"freeCashFlow,omitempty"` // OCF - |CapEx|
	DividendsPaid     *float64  `json:"dividendsPaid,omitempty"`
}

// yahooQuoteSummaryResponse mirrors the slice of fields we read from the
// quoteSummary endpoint. Many fields are objects with raw / fmt subfields
// — we only care about raw.
type yahooQuoteSummaryResponse struct {
	QuoteSummary struct {
		Result []struct {
			SummaryDetail struct {
				MarketCap        yahooNum `json:"marketCap"`
				TrailingPE       yahooNum `json:"trailingPE"`
				ForwardPE        yahooNum `json:"forwardPE"`
				FiftyTwoWeekHigh yahooNum `json:"fiftyTwoWeekHigh"`
				FiftyTwoWeekLow  yahooNum `json:"fiftyTwoWeekLow"`
				DividendYield    yahooNum `json:"dividendYield"`
				DividendRate     yahooNum `json:"dividendRate"`
				PayoutRatio      yahooNum `json:"payoutRatio"`
				Beta             yahooNum `json:"beta"`
				AverageVolume    yahooNum `json:"averageVolume"`
				Currency         string   `json:"currency"`
			} `json:"summaryDetail"`
			DefaultKeyStatistics struct {
				EnterpriseValue yahooNum `json:"enterpriseValue"`
				PriceToBook     yahooNum `json:"priceToBook"`
				TrailingEps     yahooNum `json:"trailingEps"`
				ForwardEps      yahooNum `json:"forwardEps"`
				ProfitMargins   yahooNum `json:"profitMargins"`
			} `json:"defaultKeyStatistics"`
			SummaryProfile struct {
				Sector              string `json:"sector"`
				Industry            string `json:"industry"`
				FullTimeEmployees   int64  `json:"fullTimeEmployees"`
				LongBusinessSummary string `json:"longBusinessSummary"`
				Website             string `json:"website"`
			} `json:"summaryProfile"`
			FinancialData struct {
				ReturnOnEquity yahooNum `json:"returnOnEquity"`
				DebtToEquity   yahooNum `json:"debtToEquity"`
				EBITDA         yahooNum `json:"ebitda"`
			} `json:"financialData"`
			CalendarEvents struct {
				Earnings struct {
					EarningsDate []yahooNum `json:"earningsDate"`
				} `json:"earnings"`
				ExDividendDate yahooNum `json:"exDividendDate"`
				DividendDate   yahooNum `json:"dividendDate"`
			} `json:"calendarEvents"`
			IncomeStatementHistory struct {
				IncomeStatementHistory []struct {
					EndDate         yahooNum `json:"endDate"`
					TotalRevenue    yahooNum `json:"totalRevenue"`
					GrossProfit     yahooNum `json:"grossProfit"`
					OperatingIncome yahooNum `json:"operatingIncome"`
					NetIncome       yahooNum `json:"netIncome"`
					EBITDA          yahooNum `json:"ebitda"`
				} `json:"incomeStatementHistory"`
			} `json:"incomeStatementHistory"`
			IncomeStatementHistoryQuarterly struct {
				IncomeStatementHistory []struct {
					EndDate         yahooNum `json:"endDate"`
					TotalRevenue    yahooNum `json:"totalRevenue"`
					GrossProfit     yahooNum `json:"grossProfit"`
					OperatingIncome yahooNum `json:"operatingIncome"`
					NetIncome       yahooNum `json:"netIncome"`
					EBITDA          yahooNum `json:"ebitda"`
				} `json:"incomeStatementHistory"`
			} `json:"incomeStatementHistoryQuarterly"`
			BalanceSheetHistory struct {
				BalanceSheetStatements []yahooBalanceSheetRow `json:"balanceSheetStatements"`
			} `json:"balanceSheetHistory"`
			BalanceSheetHistoryQuarterly struct {
				BalanceSheetStatements []yahooBalanceSheetRow `json:"balanceSheetStatements"`
			} `json:"balanceSheetHistoryQuarterly"`
			CashflowStatementHistory struct {
				CashflowStatements []yahooCashFlowRow `json:"cashflowStatements"`
			} `json:"cashflowStatementHistory"`
			CashflowStatementHistoryQuarterly struct {
				CashflowStatements []yahooCashFlowRow `json:"cashflowStatements"`
			} `json:"cashflowStatementHistoryQuarterly"`
		} `json:"result"`
		Error *struct {
			Code        string `json:"code"`
			Description string `json:"description"`
		} `json:"error"`
	} `json:"quoteSummary"`
}

// yahooNum unwraps Yahoo's `{ "raw": 12.34, "fmt": "12.34" }` envelopes
// into a plain Go pointer. Many fields are missing in the response; the
// pointer being nil distinguishes that from "value is zero".
type yahooNum struct {
	Raw *float64 `json:"raw"`
}

type yahooBalanceSheetRow struct {
	EndDate                yahooNum `json:"endDate"`
	TotalAssets            yahooNum `json:"totalAssets"`
	TotalLiab              yahooNum `json:"totalLiab"`
	TotalStockholderEquity yahooNum `json:"totalStockholderEquity"`
	LongTermDebt           yahooNum `json:"longTermDebt"`
	ShortLongTermDebt      yahooNum `json:"shortLongTermDebt"`
	Cash                   yahooNum `json:"cash"`
}

type yahooCashFlowRow struct {
	EndDate                              yahooNum `json:"endDate"`
	TotalCashFromOperatingActivities     yahooNum `json:"totalCashFromOperatingActivities"`
	TotalCashflowsFromInvestingActivities yahooNum `json:"totalCashflowsFromInvestingActivities"`
	TotalCashFromFinancingActivities     yahooNum `json:"totalCashFromFinancingActivities"`
	CapitalExpenditures                  yahooNum `json:"capitalExpenditures"`
	DividendsPaid                        yahooNum `json:"dividendsPaid"`
}

func (y yahooNum) Value() *float64 {
	if y.Raw == nil {
		return nil
	}
	v := *y.Raw
	return &v
}

const (
	yahooQuoteSummaryURL = "https://query1.finance.yahoo.com/v10/finance/quoteSummary/%s"
	cacheTTL             = 24 * time.Hour
	// Bump the version suffix when the response shape changes so old
	// cached blobs (without new fields) get re-fetched naturally.
	cacheKeyPrefix = "fundamentals:v2:"
)

// Service caches + serves fundamentals.
type Service struct {
	rdb *redis.Client
}

func NewService(rdb *redis.Client) *Service { return &Service{rdb: rdb} }

// Get returns fundamentals for a ticker, cached for 24h. Empty result if
// Yahoo has no data for the symbol.
func (s *Service) Get(ctx context.Context, ticker string) (*Fundamentals, error) {
	ticker = strings.ToUpper(strings.TrimSpace(ticker))
	if ticker == "" {
		return nil, errors.New("ticker required")
	}

	// Serve from cache when available.
	if raw, err := s.rdb.Get(ctx, cacheKeyPrefix+ticker).Bytes(); err == nil {
		var out Fundamentals
		if err := json.Unmarshal(raw, &out); err == nil {
			return &out, nil
		}
	}

	// Resolve to a Yahoo symbol the same way price feeds do.
	symbol, ok := price.NSESymbols[ticker]
	if !ok {
		if strings.ContainsAny(ticker, ".-^") {
			symbol = ticker
		} else {
			symbol = ticker + ".NS"
		}
	}

	out, err := fetchFromYahoo(ctx, symbol)
	if err != nil {
		return nil, err
	}
	out.Symbol = ticker
	out.UpdatedAt = time.Now().UTC()

	// Cache for 24h. A short cache on misses too, so we don't hammer Yahoo
	// for tickers that don't have fundamentals data (indices, ETFs).
	if b, err := json.Marshal(out); err == nil {
		_ = s.rdb.Set(ctx, cacheKeyPrefix+ticker, b, cacheTTL).Err()
	}
	return out, nil
}

func fetchFromYahoo(ctx context.Context, symbol string) (*Fundamentals, error) {
	client, crumb, err := globalYahoo.authenticatedClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("yahoo session: %w", err)
	}

	q := url.Values{}
	q.Set("modules", strings.Join([]string{
		"summaryDetail", "defaultKeyStatistics", "summaryProfile", "financialData",
		"calendarEvents",
		"incomeStatementHistory", "incomeStatementHistoryQuarterly",
		"balanceSheetHistory", "balanceSheetHistoryQuarterly",
		"cashflowStatementHistory", "cashflowStatementHistoryQuarterly",
	}, ","))
	q.Set("crumb", crumb)
	endpoint := fmt.Sprintf(yahooQuoteSummaryURL, url.PathEscape(symbol)) + "?" + q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", yahooUserAgent)
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		// Crumb may have rotated — invalidate and ask the caller to retry.
		globalYahoo.invalidate()
		return nil, fmt.Errorf("yahoo quoteSummary: %s (crumb invalidated)", resp.Status)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("yahoo quoteSummary: %s", resp.Status)
	}

	var parsed yahooQuoteSummaryResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}
	if parsed.QuoteSummary.Error != nil {
		return nil, fmt.Errorf("yahoo: %s — %s",
			parsed.QuoteSummary.Error.Code, parsed.QuoteSummary.Error.Description)
	}
	if len(parsed.QuoteSummary.Result) == 0 {
		return nil, fmt.Errorf("yahoo: no result for %s", symbol)
	}

	r := parsed.QuoteSummary.Result[0]
	sd := r.SummaryDetail
	ks := r.DefaultKeyStatistics
	sp := r.SummaryProfile
	fd := r.FinancialData
	ce := r.CalendarEvents
	is := r.IncomeStatementHistory.IncomeStatementHistory

	// EPS: prefer trailing, fall back to forward.
	var eps *float64
	if v := ks.TrailingEps.Value(); v != nil {
		eps = v
	} else if v := ks.ForwardEps.Value(); v != nil {
		eps = v
	}

	out := &Fundamentals{
		MarketCap:        sd.MarketCap.Value(),
		TrailingPE:       sd.TrailingPE.Value(),
		ForwardPE:        sd.ForwardPE.Value(),
		PriceToBook:      ks.PriceToBook.Value(),
		EPS:              eps,
		EnterpriseValue:  ks.EnterpriseValue.Value(),
		FiftyTwoWeekHigh: sd.FiftyTwoWeekHigh.Value(),
		FiftyTwoWeekLow:  sd.FiftyTwoWeekLow.Value(),
		Beta:             sd.Beta.Value(),
		DividendYield:    sd.DividendYield.Value(),
		DividendRate:     sd.DividendRate.Value(),
		PayoutRatio:      sd.PayoutRatio.Value(),
		ProfitMargins:    ks.ProfitMargins.Value(),
		ReturnOnEquity:   fd.ReturnOnEquity.Value(),
		DebtToEquity:     fd.DebtToEquity.Value(),
		Sector:           sp.Sector,
		Industry:         sp.Industry,
		Description:      sp.LongBusinessSummary,
		Website:          sp.Website,
		Currency:         sd.Currency,
	}
	if v := sd.AverageVolume.Value(); v != nil {
		n := int64(*v)
		out.AverageVolume = &n
	}
	if sp.FullTimeEmployees > 0 {
		emp := sp.FullTimeEmployees
		out.FullTimeEmployees = &emp
	}

	// Calendar events — Yahoo returns unix seconds. Earnings is an array;
	// pick the soonest future date. Dividend dates are single timestamps.
	now := time.Now()
	for _, d := range ce.Earnings.EarningsDate {
		if v := d.Value(); v != nil {
			t := time.Unix(int64(*v), 0).UTC()
			if t.After(now) {
				if out.NextEarningsDate == nil || t.Before(*out.NextEarningsDate) {
					ts := t
					out.NextEarningsDate = &ts
				}
			}
		}
	}
	if v := ce.ExDividendDate.Value(); v != nil {
		t := time.Unix(int64(*v), 0).UTC()
		out.ExDividendDate = &t
	}
	if v := ce.DividendDate.Value(); v != nil {
		t := time.Unix(int64(*v), 0).UTC()
		out.DividendPayDate = &t
	}

	// Income statement history — most-recent first.
	for _, row := range is {
		end := row.EndDate.Value()
		if end == nil {
			continue
		}
		t := time.Unix(int64(*end), 0).UTC()
		out.Financials = append(out.Financials, YearlyFinancials{
			Year:            t.Year(),
			EndDate:         t,
			TotalRevenue:    row.TotalRevenue.Value(),
			GrossProfit:     row.GrossProfit.Value(),
			OperatingIncome: row.OperatingIncome.Value(),
			NetIncome:       row.NetIncome.Value(),
			EBITDA:          row.EBITDA.Value(),
		})
	}

	// Quarterly income statement — most-recent first.
	for _, row := range r.IncomeStatementHistoryQuarterly.IncomeStatementHistory {
		end := row.EndDate.Value()
		if end == nil {
			continue
		}
		t := time.Unix(int64(*end), 0).UTC()
		out.QuarterlyFinancials = append(out.QuarterlyFinancials, YearlyFinancials{
			Year:            t.Year(),
			EndDate:         t,
			TotalRevenue:    row.TotalRevenue.Value(),
			GrossProfit:     row.GrossProfit.Value(),
			OperatingIncome: row.OperatingIncome.Value(),
			NetIncome:       row.NetIncome.Value(),
			EBITDA:          row.EBITDA.Value(),
		})
	}

	// Balance sheet — annual + quarterly.
	for _, row := range r.BalanceSheetHistory.BalanceSheetStatements {
		if p := mapBalanceSheet(row); p != nil {
			out.BalanceSheets = append(out.BalanceSheets, *p)
		}
	}
	for _, row := range r.BalanceSheetHistoryQuarterly.BalanceSheetStatements {
		if p := mapBalanceSheet(row); p != nil {
			out.QuarterlyBalanceSheets = append(out.QuarterlyBalanceSheets, *p)
		}
	}

	// Cash flow — annual + quarterly. Free cash flow = OCF - |CapEx|.
	for _, row := range r.CashflowStatementHistory.CashflowStatements {
		if p := mapCashFlow(row); p != nil {
			out.CashFlows = append(out.CashFlows, *p)
		}
	}
	for _, row := range r.CashflowStatementHistoryQuarterly.CashflowStatements {
		if p := mapCashFlow(row); p != nil {
			out.QuarterlyCashFlows = append(out.QuarterlyCashFlows, *p)
		}
	}
	return out, nil
}

func mapBalanceSheet(row yahooBalanceSheetRow) *BalanceSheetPeriod {
	end := row.EndDate.Value()
	if end == nil {
		return nil
	}
	t := time.Unix(int64(*end), 0).UTC()
	return &BalanceSheetPeriod{
		Year:              t.Year(),
		EndDate:           t,
		TotalAssets:       row.TotalAssets.Value(),
		TotalLiabilities:  row.TotalLiab.Value(),
		StockholderEquity: row.TotalStockholderEquity.Value(),
		LongTermDebt:      row.LongTermDebt.Value(),
		ShortTermDebt:     row.ShortLongTermDebt.Value(),
		Cash:              row.Cash.Value(),
	}
}

func mapCashFlow(row yahooCashFlowRow) *CashFlowPeriod {
	end := row.EndDate.Value()
	if end == nil {
		return nil
	}
	t := time.Unix(int64(*end), 0).UTC()
	p := &CashFlowPeriod{
		Year:              t.Year(),
		EndDate:           t,
		OperatingCashFlow: row.TotalCashFromOperatingActivities.Value(),
		InvestingCashFlow: row.TotalCashflowsFromInvestingActivities.Value(),
		FinancingCashFlow: row.TotalCashFromFinancingActivities.Value(),
		CapEx:             row.CapitalExpenditures.Value(),
		DividendsPaid:     row.DividendsPaid.Value(),
	}
	// Free cash flow: OCF - |CapEx|. CapEx is reported as negative
	// (cash out), so we add it.
	if p.OperatingCashFlow != nil && p.CapEx != nil {
		fcf := *p.OperatingCashFlow + *p.CapEx
		p.FreeCashFlow = &fcf
	}
	return p
}

// ── HTTP ─────────────────────────────────────────────────────────────────

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Routes(r chi.Router) {
	r.Get("/quotes/{ticker}/fundamentals", h.get)
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	ticker := chi.URLParam(r, "ticker")
	out, err := h.svc.Get(r.Context(), ticker)
	if err != nil {
		log.Warn().Err(err).Str("ticker", ticker).Msg("fundamentals fetch")
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}
