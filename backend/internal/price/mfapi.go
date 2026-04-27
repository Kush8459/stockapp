package price

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"
	"github.com/shopspring/decimal"
)

// MFSchemes maps short demo tickers → AMFI scheme code. This map is a
// backward-compat shim for the original demo seed (AXISBLUE / PPFAS etc.) —
// the curated MF catalog the UI surfaces is loaded dynamically from
// mfapi.in's directory in package internal/mf, and transactions for those
// funds use the canonical "MF<schemeCode>" ticker shape (see ParseMFTicker).
var MFSchemes = map[string]int{
	"AXISBLUE": 120465, // Axis Bluechip Fund - Direct Plan - Growth
	"PPFAS":    122639, // Parag Parikh Flexi Cap Fund - Direct Plan - Growth
	"QUANTSM":  120823, // Quant Small Cap Fund - Direct Plan - Growth
	"MIRAE":    118989, // Mirae Asset Large Cap Fund - Direct Plan - Growth
}

// ParseMFTicker resolves a ticker to an AMFI scheme code. Two formats:
//   - "MF120586" — canonical, used by the dynamically-loaded catalog
//   - short names in MFSchemes (legacy demo tickers like "AXISBLUE")
//
// Returns (code, true) if the ticker maps to an MF scheme, (0, false) otherwise.
func ParseMFTicker(ticker string) (int, bool) {
	if code, ok := MFSchemes[ticker]; ok {
		return code, true
	}
	if len(ticker) > 2 && ticker[:2] == "MF" {
		var n int
		for _, ch := range ticker[2:] {
			if ch < '0' || ch > '9' {
				return 0, false
			}
			n = n*10 + int(ch-'0')
		}
		if n > 0 {
			return n, true
		}
	}
	return 0, false
}

// IsMFTicker reports whether a ticker resolves to a mutual-fund scheme.
// Any code dispatching by asset class can use this instead of probing MFSchemes
// directly, which would miss the MF<code> form.
func IsMFTicker(ticker string) bool {
	_, ok := ParseMFTicker(ticker)
	return ok
}

type mfapiResponse struct {
	Status  string `json:"status"`
	Meta    struct {
		SchemeCode int    `json:"scheme_code"`
		SchemeName string `json:"scheme_name"`
	} `json:"meta"`
	Data []struct {
		Date string `json:"date"` // "dd-mm-yyyy"
		NAV  string `json:"nav"`
	} `json:"data"`
}

// RunMFAPIFeed updates the latest NAV for each MF ticker every `poll`. NAVs
// are published once per trading day, so polling more than a few times per
// hour is wasteful — 30 min is a reasonable default.
//
// `tickersFn` is re-evaluated on every tick so new MF holdings or SIP plans
// can join the live-NAV set without a worker restart. Returning an empty
// slice is fine; the feed simply skips that tick.
func RunMFAPIFeed(ctx context.Context, cache *Cache, tickersFn func() []string, poll time.Duration) error {
	if poll <= 0 {
		poll = 30 * time.Minute
	}
	client := newHTTPClient()
	log.Info().Dur("poll", poll).Msg("mfapi feed starting")

	pass := func() {
		tickers := tickersFn()
		for _, ticker := range tickers {
			if err := fetchLatestNAV(ctx, client, cache, ticker); err != nil {
				log.Warn().Err(err).Str("ticker", ticker).Msg("mfapi fetch")
			}
		}
	}
	pass()

	t := time.NewTicker(poll)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-t.C:
			pass()
		}
	}
}

func fetchLatestNAV(ctx context.Context, client *http.Client, cache *Cache, ticker string) error {
	code, ok := ParseMFTicker(ticker)
	if !ok {
		return fmt.Errorf("no scheme code for %s", ticker)
	}
	url := fmt.Sprintf("https://api.mfapi.in/mf/%d/latest", code)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("mfapi %s: %s", ticker, resp.Status)
	}

	var parsed mfapiResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return err
	}
	if parsed.Status != "SUCCESS" || len(parsed.Data) == 0 {
		return fmt.Errorf("mfapi %s: no data", ticker)
	}

	latest := parsed.Data[0]
	navF, err := strconv.ParseFloat(latest.NAV, 64)
	if err != nil || navF <= 0 {
		return fmt.Errorf("mfapi %s: bad NAV %q", ticker, latest.NAV)
	}
	prev := navF
	var changePct float64
	if len(parsed.Data) > 1 {
		if p, err := strconv.ParseFloat(parsed.Data[1].NAV, 64); err == nil && p > 0 {
			prev = p
			changePct = (navF - prev) / prev * 100
		}
	}
	when, err := time.Parse("02-01-2006", latest.Date)
	if err != nil {
		when = time.Now().UTC()
	}

	return cache.Set(ctx, Quote{
		Ticker:    ticker,
		Price:     decimal.NewFromFloat(navF).Round(4),
		PrevClose: decimal.NewFromFloat(prev).Round(4),
		ChangePct: decimal.NewFromFloat(changePct).Round(4),
		UpdatedAt: when.UTC(),
	})
}

// HistoryMF returns NAV history for an MF ticker, adapted to the Range enum
// by truncating the server-side list (mfapi gives the full history on every
// call; we trim to the requested window and sub-sample if needed).
func HistoryMF(ctx context.Context, rdb *redis.Client, ticker string, r Range) ([]Candle, error) {
	code, ok := ParseMFTicker(ticker)
	if !ok {
		return nil, fmt.Errorf("no scheme code for %s", ticker)
	}

	key := fmt.Sprintf("candles:%s:%s", ticker, r)
	if raw, err := rdb.Get(ctx, key).Bytes(); err == nil {
		var cached []Candle
		if err := json.Unmarshal(raw, &cached); err == nil {
			return cached, nil
		}
	}

	url := fmt.Sprintf("https://api.mfapi.in/mf/%d", code)
	client := newHTTPClient()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("mfapi history %s: %s", ticker, resp.Status)
	}
	var parsed mfapiResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, err
	}
	if parsed.Status != "SUCCESS" {
		return nil, fmt.Errorf("mfapi %s history: no data", ticker)
	}

	// mfapi returns newest-first; reverse to chronological.
	points := make([]Candle, 0, len(parsed.Data))
	for i := len(parsed.Data) - 1; i >= 0; i-- {
		d := parsed.Data[i]
		nav, err := strconv.ParseFloat(d.NAV, 64)
		if err != nil || nav <= 0 {
			continue
		}
		when, err := time.Parse("02-01-2006", d.Date)
		if err != nil {
			continue
		}
		points = append(points, Candle{
			Time:  when.Unix(),
			Open:  nav,
			High:  nav,
			Low:   nav,
			Close: nav,
		})
	}

	trimmed := trimToRange(points, r)
	ttl := rangeMap[r].TTL
	if b, err := json.Marshal(trimmed); err == nil {
		_ = rdb.Set(ctx, key, b, ttl).Err()
	}
	return trimmed, nil
}

// trimToRange keeps only the points within the requested window and caps
// density — MF history can run ~4000 points; charting more than ~400
// just slows the UI.
func trimToRange(points []Candle, r Range) []Candle {
	if len(points) == 0 {
		return points
	}
	now := time.Now().Unix()
	var cutoff int64
	maxPoints := 400
	switch r {
	case Range1D, Range1W:
		cutoff = now - 7*86400
		maxPoints = 120
	case Range1M:
		cutoff = now - 31*86400
	case Range3M:
		cutoff = now - 92*86400
	case Range1Y:
		cutoff = now - 366*86400
	case Range5Y:
		cutoff = now - 5*366*86400
	case RangeMax:
		cutoff = 0
	default:
		cutoff = now - 366*86400
	}
	filtered := points[:0]
	for _, p := range points {
		if p.Time >= cutoff {
			filtered = append(filtered, p)
		}
	}
	if len(filtered) <= maxPoints {
		return filtered
	}
	// Down-sample by striding.
	stride := len(filtered) / maxPoints
	if stride < 1 {
		stride = 1
	}
	out := make([]Candle, 0, maxPoints+1)
	for i := 0; i < len(filtered); i += stride {
		out = append(out, filtered[i])
	}
	// Always include the last (most recent) point so the chart ends on now.
	if last := filtered[len(filtered)-1]; len(out) == 0 || out[len(out)-1].Time != last.Time {
		out = append(out, last)
	}
	return out
}
