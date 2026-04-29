package portfolio

import (
	"context"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/shopspring/decimal"

	"github.com/stockapp/backend/internal/price"
)

// SeriesRange picks the time window for a portfolio time-series request.
// "all" returns from the very first transaction.
type SeriesRange string

const (
	Series1M  SeriesRange = "1m"
	Series3M  SeriesRange = "3m"
	Series6M  SeriesRange = "6m"
	Series1Y  SeriesRange = "1y"
	Series5Y  SeriesRange = "5y"
	SeriesAll SeriesRange = "all"
)

// SeriesPoint is one daily bar of portfolio value.
type SeriesPoint struct {
	Time     int64           `json:"time"`     // unix seconds (00:00 UTC of that calendar day)
	Value    decimal.Decimal `json:"value"`    // mark-to-market portfolio value
	Invested decimal.Decimal `json:"invested"` // running cost basis (sum of buys − cost of units sold)
}

// Series is the response shape of the time-series endpoint.
type Series struct {
	Points        []SeriesPoint `json:"points"`
	FirstTxnDate  *time.Time    `json:"firstTxnDate,omitempty"`
	Range         SeriesRange   `json:"range"`
	StartValue    decimal.Decimal `json:"startValue"`    // value at the first emitted point
	StartInvested decimal.Decimal `json:"startInvested"` // invested at the first emitted point
}

// TimeSeries replays the portfolio's full transaction history day by day,
// pricing the holdings at each day's EOD close. The result is suitable for
// overlaying with a benchmark index on the dashboard.
//
// Algorithm
// ---------
//   1. Fetch every transaction ordered by executed_at.
//   2. Pull `5y` candles for each unique ticker once (cached in Redis).
//   3. Build ticker → date → close maps.
//   4. Walk weekdays from `from` to today; on each day:
//      - apply transactions executed on or before that day to running holdings
//      - sum (units × close-on-or-before-that-day) for each holding
//   5. Trim to the caller's requested `range` window (but keep the replay
//      starting from the first txn so cost basis is accurate).
//
// Closes for non-trading days fall back to the most recent prior close.
// Tickers without any close data are valued at the user's last buy price
// (so a missing-data fund doesn't make the line collapse to ₹0).
func (s *Service) TimeSeries(ctx context.Context, portfolioID uuid.UUID, r SeriesRange) (*Series, error) {
	txns, err := s.repo.ListTxnsForReplay(ctx, portfolioID)
	if err != nil {
		return nil, err
	}
	if len(txns) == 0 {
		return &Series{Points: []SeriesPoint{}, Range: r}, nil
	}

	firstTxn := txns[0].ExecutedAt
	out := &Series{Range: r, FirstTxnDate: &firstTxn}

	// Resolve the closes window we'll need. We always pull `5y` (the longest
	// daily-resolution range Yahoo gives us) so any range request fits.
	closes, fallbacks := s.fetchCloses(ctx, txns)

	// Replay window: from first txn to today.
	now := time.Now().UTC()
	from := dateOnly(firstTxn)
	to := dateOnly(now)

	// Visible window: clip from below per the requested range.
	visibleFrom := visibleFromDate(r, from, to)

	// Holdings replay state.
	holdings := map[string]decimal.Decimal{}     // ticker → units
	avgPrice := map[string]decimal.Decimal{}     // ticker → wavg buy price
	invested := decimal.Zero                     // running cost basis
	tIdx := 0                                    // pointer into txns

	for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
		// Apply every transaction whose executed_at is on or before this day.
		for tIdx < len(txns) && !dateOnly(txns[tIdx].ExecutedAt).After(d) {
			t := txns[tIdx]
			tIdx++
			applyTxn(holdings, avgPrice, &invested, t)
		}

		// Skip weekend days from the emission to keep the series compact.
		// Holidays still emit (we use last available close) — there's no
		// reliable holiday calendar in scope.
		wd := d.Weekday()
		if wd == time.Saturday || wd == time.Sunday {
			continue
		}
		if d.Before(visibleFrom) {
			continue
		}

		value := decimal.Zero
		for ticker, qty := range holdings {
			if qty.IsZero() {
				continue
			}
			close := lookupClose(closes[ticker], d, fallbacks[ticker])
			if close.IsZero() {
				// Last-resort: use the user's avg buy price so the line doesn't
				// collapse on a fund with no candle data.
				close = avgPrice[ticker]
			}
			value = value.Add(close.Mul(qty))
		}
		out.Points = append(out.Points, SeriesPoint{
			Time:     time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, time.UTC).Unix(),
			Value:    value.Round(2),
			Invested: invested.Round(2),
		})
	}

	if len(out.Points) > 0 {
		out.StartValue = out.Points[0].Value
		out.StartInvested = out.Points[0].Invested
	}
	return out, nil
}

// applyTxn updates the running holdings + cost basis from a single trade.
func applyTxn(holdings map[string]decimal.Decimal, avg map[string]decimal.Decimal, invested *decimal.Decimal, t TxnRow) {
	curQty := holdings[t.Ticker]
	curAvg := avg[t.Ticker]
	gross := t.Price.Mul(t.Quantity)
	switch t.Side {
	case "buy":
		newQty := curQty.Add(t.Quantity)
		// weighted-average cost basis
		if newQty.IsZero() {
			avg[t.Ticker] = decimal.Zero
		} else {
			avg[t.Ticker] = curAvg.Mul(curQty).Add(gross).Div(newQty)
		}
		holdings[t.Ticker] = newQty
		*invested = invested.Add(gross)
	case "sell":
		// Reduce quantity; cost basis trimmed proportional to units sold.
		if curQty.Sign() <= 0 {
			return
		}
		soldFraction := t.Quantity.Div(curQty)
		costSold := curAvg.Mul(curQty).Mul(soldFraction)
		holdings[t.Ticker] = curQty.Sub(t.Quantity)
		// avg buy price doesn't change on sell (FIFO/avg-cost both leave it).
		*invested = invested.Sub(costSold)
		if invested.Sign() < 0 {
			*invested = decimal.Zero
		}
	}
}

// fetchCloses fetches `5y` candles for every unique ticker in `txns` and
// returns a {ticker → date → close} map plus a {ticker → sorted dates} index
// for "last close on or before D" lookups when D is a holiday.
func (s *Service) fetchCloses(
	ctx context.Context,
	txns []TxnRow,
) (map[string]map[string]decimal.Decimal, map[string][]string) {
	uniq := map[string]struct{}{}
	for _, t := range txns {
		uniq[t.Ticker] = struct{}{}
	}
	closes := make(map[string]map[string]decimal.Decimal, len(uniq))
	dates := make(map[string][]string, len(uniq))

	for ticker := range uniq {
		bars := s.candlesFor(ctx, ticker)
		if len(bars) == 0 {
			continue
		}
		m := make(map[string]decimal.Decimal, len(bars))
		ds := make([]string, 0, len(bars))
		for _, c := range bars {
			d := time.Unix(c.Time, 0).UTC().Format("2006-01-02")
			m[d] = decimal.NewFromFloat(c.Close)
			ds = append(ds, d)
		}
		sort.Strings(ds)
		closes[ticker] = m
		dates[ticker] = ds
	}
	return closes, dates
}

// candlesFor routes MF tickers to mfapi and stocks to Yahoo. Errors are
// swallowed: the caller falls back to avg-buy-price for unknown tickers.
func (s *Service) candlesFor(ctx context.Context, ticker string) []price.Candle {
	if s.rdb == nil {
		return nil
	}
	if price.IsMFTicker(ticker) {
		bars, _ := price.HistoryMF(ctx, s.rdb, ticker, price.Range5Y)
		return bars
	}
	bars, _ := price.HistoryYahoo(ctx, s.rdb, ticker, price.Range5Y)
	return bars
}

// lookupClose returns the close price for `d`, or for the closest prior
// trading day if `d` itself has no bar (weekends were already filtered out
// upstream, but holidays still hit this path).
func lookupClose(byDate map[string]decimal.Decimal, d time.Time, sortedDates []string) decimal.Decimal {
	if byDate == nil {
		return decimal.Zero
	}
	target := d.Format("2006-01-02")
	if v, ok := byDate[target]; ok {
		return v
	}
	// Binary search for the largest date ≤ target.
	idx := sort.SearchStrings(sortedDates, target)
	if idx == 0 {
		return decimal.Zero
	}
	return byDate[sortedDates[idx-1]]
}

func dateOnly(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

func visibleFromDate(r SeriesRange, from, to time.Time) time.Time {
	switch r {
	case Series1M:
		return to.AddDate(0, -1, 0)
	case Series3M:
		return to.AddDate(0, -3, 0)
	case Series6M:
		return to.AddDate(0, -6, 0)
	case Series1Y:
		return to.AddDate(-1, 0, 0)
	case Series5Y:
		return to.AddDate(-5, 0, 0)
	case SeriesAll:
		fallthrough
	default:
		return from
	}
}

// ParseSeriesRange parses a query-string range; defaults to "all".
func ParseSeriesRange(raw string) SeriesRange {
	switch SeriesRange(raw) {
	case Series1M, Series3M, Series6M, Series1Y, Series5Y, SeriesAll:
		return SeriesRange(raw)
	}
	return SeriesAll
}

// rdbProvider is an embeddable shim used by the test/build to make the
// service-side fetchCloses runnable without a Redis client. Production wiring
// uses Service.rdb directly.
var _ = (*redis.Client)(nil)
