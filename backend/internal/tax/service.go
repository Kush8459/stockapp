package tax

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"github.com/stockapp/backend/internal/price"
)

// Indian capital-gains rates applied post-July-2024.
var (
	stcgEquityPct       = decimal.NewFromFloat(20.0) // 20% short-term equity
	ltcgEquityPct       = decimal.NewFromFloat(12.5) // 12.5% long-term equity
	ltcgEquityExemption = decimal.NewFromInt(125000) // ₹1.25 L per-FY exemption
	longTermHoldingDays = 365                        // equity/MF long-term cutoff
)

// lot is one FIFO-tracked purchase remaining in a position.
type lot struct {
	Qty   decimal.Decimal
	Price decimal.Decimal
	Date  time.Time
}

// positionKey identifies a position. Ticker alone isn't enough because the
// same string could, in principle, exist in two asset types.
type positionKey struct{ Ticker, AssetType string }

type Service struct {
	db     *pgxpool.Pool
	prices *price.Cache
}

func NewService(db *pgxpool.Pool, prices *price.Cache) *Service {
	return &Service{db: db, prices: prices}
}

// Report returns the user's full realized + unrealized tax picture.
func (s *Service) Report(ctx context.Context, userID uuid.UUID) (*Report, error) {
	type txn struct {
		ID        uuid.UUID
		Ticker    string
		AssetType string
		Side      string
		Qty       decimal.Decimal
		Price     decimal.Decimal
		At        time.Time
	}
	rows, err := s.db.Query(ctx, `
		SELECT id, ticker, asset_type, side, quantity, price, executed_at
		FROM transactions
		WHERE user_id = $1
		ORDER BY executed_at ASC, id ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	txns := make([]txn, 0, 64)
	for rows.Next() {
		var t txn
		if err := rows.Scan(&t.ID, &t.Ticker, &t.AssetType, &t.Side, &t.Qty, &t.Price, &t.At); err != nil {
			return nil, err
		}
		txns = append(txns, t)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// FIFO lot queues.
	lots := map[positionKey][]lot{}
	realizations := []Realization{}

	for _, t := range txns {
		k := positionKey{t.Ticker, t.AssetType}
		switch t.Side {
		case "buy":
			lots[k] = append(lots[k], lot{Qty: t.Qty, Price: t.Price, Date: t.At})

		case "sell":
			remaining := t.Qty
			queue := lots[k]
			for remaining.Sign() > 0 && len(queue) > 0 {
				head := &queue[0]
				consumed := remaining
				if head.Qty.Cmp(consumed) < 0 {
					consumed = head.Qty
				}

				holdingDays := int(t.At.Sub(head.Date).Hours() / 24)
				term := TermShort
				if holdingDays >= longTermHoldingDays {
					term = TermLong
				}

				proceeds := t.Price.Mul(consumed)
				cost := head.Price.Mul(consumed)
				gain := proceeds.Sub(cost)

				realizations = append(realizations, Realization{
					Ticker:            t.Ticker,
					AssetType:         t.AssetType,
					Quantity:          consumed,
					BuyDate:           head.Date,
					BuyPrice:          head.Price,
					SellDate:          t.At,
					SellPrice:         t.Price,
					HoldingDays:       holdingDays,
					Proceeds:          proceeds.Round(2),
					CostBasis:         cost.Round(2),
					Gain:              gain.Round(2),
					Term:              term,
					Category:          categoryFor(t.AssetType, term),
					SellTransactionID: t.ID,
				})

				head.Qty = head.Qty.Sub(consumed)
				remaining = remaining.Sub(consumed)
				if head.Qty.Sign() <= 0 {
					queue = queue[1:]
				}
			}
			lots[k] = queue
		}
	}

	// Bucket realizations by Indian financial year.
	byFY := map[string]*YearSummary{}
	for _, r := range realizations {
		fy := financialYearOf(r.SellDate)
		y, ok := byFY[fy]
		if !ok {
			y = newYearSummary(fy)
			byFY[fy] = y
		}
		y.Realizations = append(y.Realizations, r)
		switch r.Category {
		case CategorySTCGEquity:
			y.STCGEquityGain = y.STCGEquityGain.Add(r.Gain)
		case CategoryLTCGEquity:
			y.LTCGEquityGain = y.LTCGEquityGain.Add(r.Gain)
		}
	}

	// Finalize tax math per year.
	years := make([]YearSummary, 0, len(byFY))
	for _, y := range byFY {
		if y.STCGEquityGain.Sign() > 0 {
			y.STCGEquityTax = y.STCGEquityGain.Mul(stcgEquityPct).Div(decimal.NewFromInt(100)).Round(2)
		}
		if y.LTCGEquityGain.Sign() > 0 {
			exemption := y.LTCGEquityGain
			if exemption.Cmp(ltcgEquityExemption) > 0 {
				exemption = ltcgEquityExemption
			}
			y.LTCGExemptionUsed = exemption
			y.LTCGTaxableGain = y.LTCGEquityGain.Sub(exemption)
			if y.LTCGTaxableGain.Sign() < 0 {
				y.LTCGTaxableGain = decimal.Zero
			}
			y.LTCGEquityTax = y.LTCGTaxableGain.Mul(ltcgEquityPct).Div(decimal.NewFromInt(100)).Round(2)
		}
		y.TotalGain = y.STCGEquityGain.Add(y.LTCGEquityGain).Round(2)
		y.TotalTax = y.STCGEquityTax.Add(y.LTCGEquityTax).Round(2)
		if y.TotalGain.Sign() > 0 {
			y.EffectiveRate = y.TotalTax.Div(y.TotalGain).Mul(decimal.NewFromInt(100)).Round(2)
		}

		sort.Slice(y.Realizations, func(i, j int) bool {
			return y.Realizations[i].SellDate.After(y.Realizations[j].SellDate)
		})
		years = append(years, *y)
	}
	sort.Slice(years, func(i, j int) bool {
		return years[i].StartDate.After(years[j].StartDate)
	})

	unreal := s.computeUnrealized(ctx, lots)

	return &Report{
		GeneratedAt: time.Now().UTC(),
		Currency:    "INR",
		Years:       years,
		Unrealized:  unreal,
		Rates: Rates{
			STCGEquityPct:       stcgEquityPct,
			LTCGEquityPct:       ltcgEquityPct,
			LTCGExemption:       ltcgEquityExemption,
			LongTermHoldingDays: longTermHoldingDays,
		},
	}, nil
}

// computeUnrealized projects "what if I sold everything right now" using the
// live-price cache. Purely informational — not recorded anywhere.
func (s *Service) computeUnrealized(ctx context.Context, lots map[positionKey][]lot) Unrealized {
	// Collect every open ticker to batch-fetch quotes in one MGET.
	tickers := make([]string, 0, len(lots))
	for k, queue := range lots {
		if len(queue) == 0 {
			continue
		}
		tickers = append(tickers, k.Ticker)
	}
	quotes, _ := s.prices.GetMany(ctx, tickers)

	var u Unrealized
	now := time.Now().UTC()
	for k, queue := range lots {
		q, ok := quotes[k.Ticker]
		if !ok || q.Price.Sign() <= 0 {
			continue
		}
		for _, l := range queue {
			if l.Qty.Sign() <= 0 {
				continue
			}
			gain := q.Price.Sub(l.Price).Mul(l.Qty)
			holdingDays := int(now.Sub(l.Date).Hours() / 24)
			term := TermShort
			if holdingDays >= longTermHoldingDays {
				term = TermLong
			}
			cat := categoryFor(k.AssetType, term)
			switch cat {
			case CategorySTCGEquity:
				u.STCGEquityGain = u.STCGEquityGain.Add(gain)
			case CategoryLTCGEquity:
				u.LTCGEquityGain = u.LTCGEquityGain.Add(gain)
			}
		}
	}
	u.STCGEquityGain = u.STCGEquityGain.Round(2)
	u.LTCGEquityGain = u.LTCGEquityGain.Round(2)
	u.TotalGain = u.STCGEquityGain.Add(u.LTCGEquityGain)
	return u
}

// categoryFor picks the tax bucket for a holding term. Mutual funds are
// treated as equity here — simplification for the demo, since debt-fund
// taxation has its own timeline-dependent rules.
func categoryFor(_ string, term Term) Category {
	if term == TermLong {
		return CategoryLTCGEquity
	}
	return CategorySTCGEquity
}

// financialYearOf returns the Indian FY label for a given date. India's FY
// runs April 1 → March 31, so a sell on 2025-02-10 belongs to "FY2024-25".
func financialYearOf(t time.Time) string {
	y := t.Year()
	if t.Month() < time.April {
		y--
	}
	return fmt.Sprintf("FY%d-%02d", y, (y+1)%100)
}

// newYearSummary initializes a fresh YearSummary with its date bounds filled
// in from the FY label.
func newYearSummary(fy string) *YearSummary {
	// Label format: "FY2024-25". Year digits start at index 2.
	start := 0
	if len(fy) >= 6 {
		start, _ = strconv.Atoi(fy[2:6])
	}
	startDate := time.Date(start, time.April, 1, 0, 0, 0, 0, time.UTC)
	endDate := time.Date(start+1, time.March, 31, 23, 59, 59, 0, time.UTC)
	return &YearSummary{
		FinancialYear: fy,
		StartDate:     startDate,
		EndDate:       endDate,
		Realizations:  []Realization{},
	}
}
