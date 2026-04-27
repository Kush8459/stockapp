package mf

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"time"
)

// Returns is the response shape for /mf/funds/{ticker}/returns.
//
// Convention (matches every Indian retail MF dashboard):
//   - 1m / 3m / 6m / 1y → absolute (point-to-point) total return %
//   - 3y / 5y / 10y / sinceInception → annualised CAGR %
//
// A nil pointer in any of these means "history doesn't go back that far"
// — the UI distinguishes "0%" from "not enough data".
type Returns struct {
	Ticker         string     `json:"ticker"`
	SchemeCode     int        `json:"schemeCode"`
	NavCurrent     string     `json:"navCurrent"`
	NavAsOf        time.Time  `json:"navAsOf"`
	InceptionDate  time.Time  `json:"inceptionDate"`
	HistoryDays    int        `json:"historyDays"`
	OneMonth       *float64   `json:"oneMonth,omitempty"`
	ThreeMonth     *float64   `json:"threeMonth,omitempty"`
	SixMonth       *float64   `json:"sixMonth,omitempty"`
	OneYear        *float64   `json:"oneYear,omitempty"`
	ThreeYear      *float64   `json:"threeYear,omitempty"`
	FiveYear       *float64   `json:"fiveYear,omitempty"`
	TenYear        *float64   `json:"tenYear,omitempty"`
	SinceInception *float64   `json:"sinceInception,omitempty"`
	// HighestNav / LowestNav over the available history. Useful detail
	// for the fund page even though it isn't a "return" per se.
	HighestNav     string     `json:"highestNav,omitempty"`
	HighestNavDate *time.Time `json:"highestNavDate,omitempty"`
	LowestNav      string     `json:"lowestNav,omitempty"`
	LowestNavDate  *time.Time `json:"lowestNavDate,omitempty"`
}

type navPoint struct {
	When time.Time
	NAV  float64
}

const fullHistoryKey = "mf:history:full:%d"
const fullHistoryTTL = 24 * time.Hour

type mfapiHistResp struct {
	Status string `json:"status"`
	Meta   struct {
		SchemeCode int    `json:"scheme_code"`
		SchemeName string `json:"scheme_name"`
	} `json:"meta"`
	Data []struct {
		Date string `json:"date"` // dd-mm-yyyy
		NAV  string `json:"nav"`
	} `json:"data"`
}

// fetchFullHistory returns the chronological NAV series for a scheme.
// Cached in Redis for a day — AMFI publishes one new NAV per scheme per
// trading day, so refreshing every 24h lines up with the data cadence.
func (h *Handler) fetchFullHistory(ctx context.Context, schemeCode int) ([]navPoint, error) {
	key := fmt.Sprintf(fullHistoryKey, schemeCode)
	if h.rdb != nil {
		if raw, err := h.rdb.Get(ctx, key).Bytes(); err == nil {
			var cached []navPoint
			if err := json.Unmarshal(raw, &cached); err == nil && len(cached) > 0 {
				return cached, nil
			}
		}
	}
	url := fmt.Sprintf("https://api.mfapi.in/mf/%d", schemeCode)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")
	resp, err := h.svc.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("mfapi history %d: %s", schemeCode, resp.Status)
	}
	var parsed mfapiHistResp
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, err
	}
	if parsed.Status != "SUCCESS" {
		return nil, fmt.Errorf("mfapi history %d: not SUCCESS", schemeCode)
	}
	out := make([]navPoint, 0, len(parsed.Data))
	for _, d := range parsed.Data {
		nav, err := parseFloat(d.NAV)
		if err != nil || nav <= 0 {
			continue
		}
		when, err := time.Parse("02-01-2006", d.Date)
		if err != nil {
			continue
		}
		out = append(out, navPoint{When: when.UTC(), NAV: nav})
	}
	// mfapi returns newest-first; sort chronological so lookups by date
	// are straightforward.
	sort.Slice(out, func(i, j int) bool { return out[i].When.Before(out[j].When) })

	if h.rdb != nil && len(out) > 0 {
		if b, err := json.Marshal(out); err == nil {
			_ = h.rdb.Set(ctx, key, b, fullHistoryTTL).Err()
		}
	}
	return out, nil
}

// returnsFor builds the full Returns struct for one scheme.
func (h *Handler) returnsFor(ctx context.Context, f Fund) (Returns, error) {
	hist, err := h.fetchFullHistory(ctx, f.SchemeCode)
	if err != nil {
		return Returns{}, err
	}
	if len(hist) < 2 {
		return Returns{}, fmt.Errorf("not enough history for %d", f.SchemeCode)
	}

	first := hist[0]
	last := hist[len(hist)-1]
	totalDays := int(last.When.Sub(first.When).Hours() / 24)
	totalYears := float64(totalDays) / 365.25

	// Compute the canonical Indian-MF return windows.
	r := Returns{
		Ticker:        f.Ticker,
		SchemeCode:    f.SchemeCode,
		NavCurrent:    formatNav(last.NAV),
		NavAsOf:       last.When,
		InceptionDate: first.When,
		HistoryDays:   totalDays,
	}

	r.OneMonth = pointToPoint(hist, last.When.AddDate(0, -1, 0), last.NAV)
	r.ThreeMonth = pointToPoint(hist, last.When.AddDate(0, -3, 0), last.NAV)
	r.SixMonth = pointToPoint(hist, last.When.AddDate(0, -6, 0), last.NAV)
	r.OneYear = pointToPoint(hist, last.When.AddDate(-1, 0, 0), last.NAV)
	r.ThreeYear = cagr(hist, last.When.AddDate(-3, 0, 0), last.NAV, 3)
	r.FiveYear = cagr(hist, last.When.AddDate(-5, 0, 0), last.NAV, 5)
	r.TenYear = cagr(hist, last.When.AddDate(-10, 0, 0), last.NAV, 10)
	if totalYears >= 1 {
		v := cagrFromValue(first.NAV, last.NAV, totalYears)
		r.SinceInception = &v
	} else if totalYears > 0 {
		// Sub-1-year fund: report point-to-point so the field isn't
		// empty. Marked as such by the UI via HistoryDays.
		v := pctChange(first.NAV, last.NAV)
		r.SinceInception = &v
	}

	// Highest / lowest NAV over the available history.
	hi := hist[0]
	lo := hist[0]
	for _, p := range hist {
		if p.NAV > hi.NAV {
			hi = p
		}
		if p.NAV < lo.NAV {
			lo = p
		}
	}
	r.HighestNav = formatNav(hi.NAV)
	r.HighestNavDate = &hi.When
	r.LowestNav = formatNav(lo.NAV)
	r.LowestNavDate = &lo.When

	return r, nil
}

// pointToPoint returns the absolute % change from the NAV closest to `when`
// to currentNAV. Returns nil if `when` is before the first available point
// (i.e., the lookback window exceeds fund history).
func pointToPoint(hist []navPoint, when time.Time, currentNAV float64) *float64 {
	p, ok := navAt(hist, when)
	if !ok {
		return nil
	}
	v := pctChange(p.NAV, currentNAV)
	return &v
}

// cagr returns annualised CAGR from `years` ago to currentNAV, or nil if
// history doesn't go back that far.
func cagr(hist []navPoint, when time.Time, currentNAV float64, years float64) *float64 {
	if hist[0].When.After(when) {
		return nil
	}
	p, ok := navAt(hist, when)
	if !ok {
		return nil
	}
	v := cagrFromValue(p.NAV, currentNAV, years)
	return &v
}

func cagrFromValue(start, end, years float64) float64 {
	if start <= 0 || years <= 0 {
		return 0
	}
	ratio := end / start
	if ratio <= 0 {
		return 0
	}
	return (math.Pow(ratio, 1.0/years) - 1) * 100
}

func pctChange(start, end float64) float64 {
	if start <= 0 {
		return 0
	}
	return (end - start) / start * 100
}

// navAt returns the NAV point on or before `when` (the most recent NAV
// not after the target date). NAVs aren't published on weekends/holidays
// so we walk back to the closest trading day. Returns ok=false if the
// fund has no NAV at or before that date.
func navAt(hist []navPoint, when time.Time) (navPoint, bool) {
	if len(hist) == 0 {
		return navPoint{}, false
	}
	if hist[0].When.After(when) {
		return navPoint{}, false
	}
	// Binary search for the largest index where hist[i].When <= when.
	lo, hi := 0, len(hist)-1
	for lo < hi {
		mid := (lo + hi + 1) / 2
		if hist[mid].When.After(when) {
			hi = mid - 1
		} else {
			lo = mid
		}
	}
	return hist[lo], true
}

func parseFloat(s string) (float64, error) {
	var n float64
	_, err := fmt.Sscanf(s, "%f", &n)
	return n, err
}

func formatNav(n float64) string {
	return fmt.Sprintf("%.4f", n)
}
