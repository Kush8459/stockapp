package price

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"
)

// Candle is one historical price bar. For area charts we only need Close,
// but we ship OHLC so a future candlestick chart can reuse the same feed.
type Candle struct {
	Time   int64   `json:"time"`   // unix seconds
	Open   float64 `json:"open"`
	High   float64 `json:"high"`
	Low    float64 `json:"low"`
	Close  float64 `json:"close"`
	Volume int64   `json:"volume"`
}

// Range is a time-range shortcut. We pick interval automatically so every
// range renders at a sensible density (≈150–400 points).
type Range string

const (
	Range1D  Range = "1d"
	Range1W  Range = "1w"
	Range1M  Range = "1m"
	Range3M  Range = "3m"
	Range1Y  Range = "1y"
	Range5Y  Range = "5y"
	RangeMax Range = "max"
)

// yahooParams holds the {range, interval} tuple we send to Yahoo for a given
// logical range — plus the Redis TTL to cache that response under.
type yahooParams struct {
	Range, Interval string
	TTL             time.Duration
}

var rangeMap = map[Range]yahooParams{
	Range1D:  {"1d", "5m", 2 * time.Minute},
	Range1W:  {"5d", "30m", 10 * time.Minute},
	Range1M:  {"1mo", "1d", 1 * time.Hour},
	Range3M:  {"3mo", "1d", 1 * time.Hour},
	Range1Y:  {"1y", "1d", 6 * time.Hour},
	Range5Y:  {"5y", "1wk", 12 * time.Hour},
	RangeMax: {"max", "1mo", 24 * time.Hour},
}

// ParseRange turns a query-string value into a known Range, defaulting to 1Y.
func ParseRange(raw string) Range {
	r := Range(strings.ToLower(strings.TrimSpace(raw)))
	if _, ok := rangeMap[r]; ok {
		return r
	}
	return Range1Y
}

type yahooHistoryResponse struct {
	Chart struct {
		Result []struct {
			Meta struct {
				Currency string `json:"currency"`
			} `json:"meta"`
			Timestamp  []int64 `json:"timestamp"`
			Indicators struct {
				Quote []struct {
					Open   []float64 `json:"open"`
					High   []float64 `json:"high"`
					Low    []float64 `json:"low"`
					Close  []float64 `json:"close"`
					Volume []int64   `json:"volume"`
				} `json:"quote"`
			} `json:"indicators"`
			// Dividends + splits are returned only when the request includes
			// `events=div` (or `events=split`). We piggy-back on the same
			// endpoint to fetch dividend history for a ticker.
			Events struct {
				Dividends map[string]struct {
					Amount float64 `json:"amount"`
					Date   int64   `json:"date"`
				} `json:"dividends"`
			} `json:"events"`
		} `json:"result"`
		Error *struct {
			Description string `json:"description"`
		} `json:"error"`
	} `json:"chart"`
}

// DividendEvent is one historical dividend payout for a ticker.
type DividendEvent struct {
	ExDate   time.Time
	PerShare float64
}

// DividendsYahoo fetches the dividend history for a ticker over the past
// `years` years from Yahoo's chart endpoint with `events=div`. Returns
// nil + nil error if Yahoo doesn't have dividend data for the symbol.
func DividendsYahoo(ctx context.Context, ticker string, years int) ([]DividendEvent, error) {
	if years <= 0 {
		years = 5
	}
	rangeStr := fmt.Sprintf("%dy", years)
	client := newHTTPClient()
	for _, sym := range yahooSymbolCandidates(ticker) {
		events, err := fetchYahooDividends(ctx, client, sym, rangeStr)
		if err != nil {
			continue
		}
		if len(events) > 0 {
			return events, nil
		}
	}
	return nil, nil
}

func fetchYahooDividends(
	ctx context.Context,
	client *http.Client,
	symbol, rangeStr string,
) ([]DividendEvent, error) {
	url := fmt.Sprintf(
		"https://query1.finance.yahoo.com/v8/finance/chart/%s?interval=1d&range=%s&events=div",
		symbol, rangeStr,
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("yahoo %s: %s", symbol, resp.Status)
	}
	var parsed yahooHistoryResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, err
	}
	if len(parsed.Chart.Result) == 0 {
		return nil, nil
	}
	divs := parsed.Chart.Result[0].Events.Dividends
	out := make([]DividendEvent, 0, len(divs))
	for _, d := range divs {
		if d.Amount <= 0 || d.Date <= 0 {
			continue
		}
		out = append(out, DividendEvent{
			ExDate:   time.Unix(d.Date, 0).UTC(),
			PerShare: d.Amount,
		})
	}
	return out, nil
}

// HistoryYahoo fetches and caches OHLC candles for the given ticker. It
// tries a small chain of Yahoo-symbol candidates until one returns data —
// callers can pass a bare ticker ("TATAMOTORS"), a US ticker ("AAPL"), or
// an already-qualified symbol ("BTC-USD", "RELIANCE.NS") and get the right
// result.
func HistoryYahoo(
	ctx context.Context,
	rdb *redis.Client,
	ticker string,
	r Range,
) ([]Candle, error) {
	p, ok := rangeMap[r]
	if !ok {
		return nil, errors.New("unknown range")
	}

	key := fmt.Sprintf("candles:%s:%s", ticker, r)
	if raw, err := rdb.Get(ctx, key).Bytes(); err == nil {
		var cached []Candle
		if err := json.Unmarshal(raw, &cached); err == nil {
			return cached, nil
		}
	}

	client := newHTTPClient()
	var lastErr error
	for _, sym := range yahooSymbolCandidates(ticker) {
		out, err := fetchYahooCandles(ctx, client, sym, p.Range, p.Interval)
		if err != nil {
			lastErr = err
			continue
		}
		if len(out) == 0 {
			continue
		}
		if b, err := json.Marshal(out); err == nil {
			_ = rdb.Set(ctx, key, b, p.TTL).Err()
		}
		return out, nil
	}
	if lastErr != nil {
		log.Warn().Err(lastErr).Str("ticker", ticker).Msg("yahoo history: no candidate worked")
	}
	return []Candle{}, nil
}

// yahooSymbolCandidates returns Yahoo-ready symbols to try, in priority
// order. Known demo tickers use their direct mapping. Anything with a dot,
// dash, or caret is trusted as-is. Everything else falls back to NSE first
// (our audience), then bare (in case it's already a Yahoo symbol), then BSE.
func yahooSymbolCandidates(ticker string) []string {
	if s, ok := NSESymbols[ticker]; ok {
		return []string{s}
	}
	if strings.ContainsAny(ticker, ".-^") {
		return []string{ticker}
	}
	return []string{ticker + ".NS", ticker, ticker + ".BO"}
}

func fetchYahooCandles(
	ctx context.Context,
	client *http.Client,
	symbol, rangeStr, interval string,
) ([]Candle, error) {
	url := fmt.Sprintf(
		"https://query1.finance.yahoo.com/v8/finance/chart/%s?interval=%s&range=%s&includePrePost=false",
		symbol, interval, rangeStr,
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("yahoo %s: %s", symbol, resp.Status)
	}
	var parsed yahooHistoryResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, err
	}
	if parsed.Chart.Error != nil {
		return nil, fmt.Errorf("yahoo: %s", parsed.Chart.Error.Description)
	}
	if len(parsed.Chart.Result) == 0 {
		return []Candle{}, nil
	}
	res := parsed.Chart.Result[0]
	if len(res.Indicators.Quote) == 0 {
		return []Candle{}, nil
	}
	q := res.Indicators.Quote[0]

	out := make([]Candle, 0, len(res.Timestamp))
	for i, t := range res.Timestamp {
		if i >= len(q.Close) || q.Close[i] == 0 {
			continue
		}
		out = append(out, Candle{
			Time:   t,
			Open:   safe(q.Open, i),
			High:   safe(q.High, i),
			Low:    safe(q.Low, i),
			Close:  q.Close[i],
			Volume: safeInt(q.Volume, i),
		})
	}
	return out, nil
}

func safe(s []float64, i int) float64 {
	if i < len(s) {
		return s[i]
	}
	return 0
}
func safeInt(s []int64, i int) int64 {
	if i < len(s) {
		return s[i]
	}
	return 0
}

