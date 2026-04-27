package mf

import (
	"context"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/stockapp/backend/internal/httpx"
)

// Metrics is the response shape for /mf/funds/{ticker}/metrics. All values
// are derived from the daily NAV series we already cache for /returns —
// no extra upstream calls.
//
// Conventions used:
//   - Volatility: annualized stdev of daily *log* returns × √252, expressed
//     as %. The √252 factor is the standard equity convention (252 trading
//     days/year). Mutual funds publish ~250 NAVs/year so this is close to
//     the right shape, even though it slightly overstates if we mix
//     weekend-skipped NAVs with sparser AMFI gaps.
//   - Sharpe ratio: (annualized mean return − risk-free rate) / annualized
//     volatility, both expressed as decimals. Risk-free proxied at 7% —
//     the post-2020 average yield on the 10y G-sec, the standard Indian
//     RFR proxy. Stored as a unitless number so a value of 1.2 means
//     "1.2 units of return per unit of risk above RFR."
//   - Max drawdown: the largest peak-to-trough decline observed, in % of
//     the peak NAV. Recovery date is the first day NAV reattains the peak,
//     or null if it hasn't yet.
//   - Calendar year returns: last NAV of year ÷ last NAV of previous year
//     − 1. Partial first/last years are dropped to keep comparisons
//     apples-to-apples.
//   - Rolling 1y: every starting date with ≥365 days of forward history
//     produces one rolling-window return. Best/worst/avg over those.
type Metrics struct {
	Ticker        string `json:"ticker"`
	SchemeCode    int    `json:"schemeCode"`
	HistoryDays   int    `json:"historyDays"`
	NavPointCount int    `json:"navPointCount"`

	// Annualised volatility of daily log returns, in %.
	Volatility *float64 `json:"volatility,omitempty"`
	// Sharpe ratio assuming 7% risk-free rate. Unitless.
	SharpeRatio *float64 `json:"sharpeRatio,omitempty"`
	// Risk-free rate used for Sharpe (always 0.07 for now), exposed so
	// the UI can show "(RFR 7%)" rather than hardcoding the same number.
	RiskFreeRate float64 `json:"riskFreeRate"`

	MaxDrawdown *Drawdown `json:"maxDrawdown,omitempty"`

	BestYear      *YearReturn  `json:"bestYear,omitempty"`
	WorstYear     *YearReturn  `json:"worstYear,omitempty"`
	YearlyReturns []YearReturn `json:"yearlyReturns,omitempty"`

	UpMonthsPct   *float64 `json:"upMonthsPct,omitempty"`
	DownMonthsPct *float64 `json:"downMonthsPct,omitempty"`

	Rolling1Y *RollingStats `json:"rolling1y,omitempty"`
}

// Drawdown describes the worst peak-to-trough decline observed. Recovery
// is nil if NAV hasn't returned to the prior peak yet (i.e., the fund is
// currently still under that peak).
type Drawdown struct {
	PercentDecline float64    `json:"percentDecline"`
	PeakDate       time.Time  `json:"peakDate"`
	PeakNav        string     `json:"peakNav"`
	TroughDate     time.Time  `json:"troughDate"`
	TroughNav      string     `json:"troughNav"`
	RecoveryDate   *time.Time `json:"recoveryDate,omitempty"`
	DurationDays   int        `json:"durationDays"`
}

// YearReturn is one calendar year's % return.
type YearReturn struct {
	Year   int     `json:"year"`
	Return float64 `json:"return"`
}

// RollingStats summarises a population of overlapping rolling-window returns.
type RollingStats struct {
	WindowDays    int     `json:"windowDays"`
	SampleCount   int     `json:"sampleCount"`
	BestReturn    float64 `json:"bestReturn"`
	WorstReturn   float64 `json:"worstReturn"`
	AverageReturn float64 `json:"averageReturn"`
	MedianReturn  float64 `json:"medianReturn"`
}

const riskFreeRate = 0.07 // 10y G-sec proxy; see comment above.

// metricsFor builds the Metrics struct for one scheme. Returns an error
// only on unrecoverable upstream failure; if history is too short for
// individual fields they're left nil.
func (h *Handler) metricsFor(ctx context.Context, f Fund) (Metrics, error) {
	hist, err := h.fetchFullHistory(ctx, f.SchemeCode)
	if err != nil {
		return Metrics{}, err
	}
	out := Metrics{
		Ticker:        f.Ticker,
		SchemeCode:    f.SchemeCode,
		NavPointCount: len(hist),
		RiskFreeRate:  riskFreeRate,
	}
	if len(hist) < 30 {
		// Less than ~6 weeks of history — every metric below would be
		// statistically meaningless. Return what we have (the count) and
		// let the UI render "not enough data".
		return out, nil
	}
	first, last := hist[0], hist[len(hist)-1]
	out.HistoryDays = int(last.When.Sub(first.When).Hours() / 24)

	// ── volatility + Sharpe (need daily log returns) ─────────────────
	logReturns := dailyLogReturns(hist)
	if len(logReturns) >= 20 {
		mean, sd := meanStdev(logReturns)
		annVol := sd * math.Sqrt(252) * 100
		annMean := (math.Exp(mean*252) - 1) // geometric annualisation
		out.Volatility = &annVol
		if annVol > 0 {
			sharpe := (annMean - riskFreeRate) / (annVol / 100)
			out.SharpeRatio = &sharpe
		}
	}

	// ── max drawdown ─────────────────────────────────────────────────
	if dd := computeMaxDrawdown(hist); dd != nil {
		out.MaxDrawdown = dd
	}

	// ── calendar-year returns (full years only) ──────────────────────
	years := calendarYearReturns(hist)
	if len(years) > 0 {
		out.YearlyReturns = years
		// best / worst by signed return; ties resolved by latest year.
		best := years[0]
		worst := years[0]
		for _, y := range years {
			if y.Return > best.Return || (y.Return == best.Return && y.Year > best.Year) {
				best = y
			}
			if y.Return < worst.Return || (y.Return == worst.Return && y.Year > worst.Year) {
				worst = y
			}
		}
		out.BestYear = &best
		out.WorstYear = &worst
	}

	// ── monthly up/down split ────────────────────────────────────────
	if up, down, ok := monthlyUpDownPct(hist); ok {
		out.UpMonthsPct = &up
		out.DownMonthsPct = &down
	}

	// ── rolling 1y returns ───────────────────────────────────────────
	if r := rollingReturns(hist, 365); r != nil {
		out.Rolling1Y = r
	}

	return out, nil
}

// dailyLogReturns produces the log-return series ln(NAV_i / NAV_{i-1}).
// Skips pairs where the gap is more than 7 days (likely AMFI publish gap)
// so a single missing-week wouldn't dominate the variance estimate.
func dailyLogReturns(hist []navPoint) []float64 {
	out := make([]float64, 0, len(hist))
	for i := 1; i < len(hist); i++ {
		gap := hist[i].When.Sub(hist[i-1].When).Hours() / 24
		if gap > 7 {
			continue
		}
		if hist[i-1].NAV <= 0 || hist[i].NAV <= 0 {
			continue
		}
		out = append(out, math.Log(hist[i].NAV/hist[i-1].NAV))
	}
	return out
}

func meanStdev(xs []float64) (mean, stdev float64) {
	if len(xs) == 0 {
		return 0, 0
	}
	sum := 0.0
	for _, x := range xs {
		sum += x
	}
	mean = sum / float64(len(xs))
	if len(xs) < 2 {
		return mean, 0
	}
	v := 0.0
	for _, x := range xs {
		d := x - mean
		v += d * d
	}
	stdev = math.Sqrt(v / float64(len(xs)-1))
	return mean, stdev
}

// computeMaxDrawdown walks chronologically, tracking the running peak.
// On each new low after a peak, evaluate whether it's the worst decline
// seen so far; if so record it. After resolving the worst, search forward
// from its trough date for the recovery point.
func computeMaxDrawdown(hist []navPoint) *Drawdown {
	if len(hist) < 2 {
		return nil
	}
	peakIdx := 0
	worstStartIdx := 0
	worstEndIdx := 0
	worstPct := 0.0
	for i := 1; i < len(hist); i++ {
		if hist[i].NAV > hist[peakIdx].NAV {
			peakIdx = i
			continue
		}
		decline := (hist[peakIdx].NAV - hist[i].NAV) / hist[peakIdx].NAV * 100
		if decline > worstPct {
			worstPct = decline
			worstStartIdx = peakIdx
			worstEndIdx = i
		}
	}
	if worstPct == 0 {
		return nil
	}
	peak := hist[worstStartIdx]
	trough := hist[worstEndIdx]
	dd := Drawdown{
		PercentDecline: worstPct,
		PeakDate:       peak.When,
		PeakNav:        formatNav(peak.NAV),
		TroughDate:     trough.When,
		TroughNav:      formatNav(trough.NAV),
		DurationDays:   int(trough.When.Sub(peak.When).Hours() / 24),
	}
	for i := worstEndIdx + 1; i < len(hist); i++ {
		if hist[i].NAV >= peak.NAV {
			t := hist[i].When
			dd.RecoveryDate = &t
			break
		}
	}
	return &dd
}

// calendarYearReturns returns one entry per *complete* calendar year
// covered by the history. The boundary point for year Y is the last NAV
// in year Y. Year-over-year return = lastNAV(Y) / lastNAV(Y-1) − 1.
//
// Partial years (the year of inception, the current year-to-date) are
// dropped — mixing them with full years would mislead the user.
func calendarYearReturns(hist []navPoint) []YearReturn {
	if len(hist) < 2 {
		return nil
	}
	// last NAV per year
	lastByYear := make(map[int]navPoint, 32)
	for _, p := range hist {
		y := p.When.UTC().Year()
		if cur, ok := lastByYear[y]; !ok || p.When.After(cur.When) {
			lastByYear[y] = p
		}
	}
	years := make([]int, 0, len(lastByYear))
	for y := range lastByYear {
		years = append(years, y)
	}
	sort.Ints(years)

	thisYear := time.Now().UTC().Year()
	out := make([]YearReturn, 0, len(years))
	for i := 1; i < len(years); i++ {
		y := years[i]
		// Skip the current calendar year — it's incomplete by definition.
		if y == thisYear {
			continue
		}
		// Skip a year if the previous year's last NAV isn't actually
		// from December (i.e. fund inception was mid-year-1, so the YoY
		// figure would be a partial-year return masquerading as annual).
		prevPt := lastByYear[years[i-1]]
		if prevPt.When.Month() < time.November && years[i-1] != y-1 {
			continue
		}
		curPt := lastByYear[y]
		if prevPt.NAV <= 0 || curPt.NAV <= 0 {
			continue
		}
		ret := (curPt.NAV - prevPt.NAV) / prevPt.NAV * 100
		out = append(out, YearReturn{Year: y, Return: ret})
	}
	// Cap to last 10 full years for the UI.
	if len(out) > 10 {
		out = out[len(out)-10:]
	}
	return out
}

// monthlyUpDownPct returns the percent of monthly NAV transitions that
// are positive / negative. Uses the last NAV of each month.
func monthlyUpDownPct(hist []navPoint) (up, down float64, ok bool) {
	if len(hist) < 60 {
		return 0, 0, false
	}
	type mk struct{ y, m int }
	last := make(map[mk]navPoint, 64)
	for _, p := range hist {
		k := mk{p.When.UTC().Year(), int(p.When.UTC().Month())}
		if cur, ok := last[k]; !ok || p.When.After(cur.When) {
			last[k] = p
		}
	}
	keys := make([]mk, 0, len(last))
	for k := range last {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].y != keys[j].y {
			return keys[i].y < keys[j].y
		}
		return keys[i].m < keys[j].m
	})
	if len(keys) < 6 {
		return 0, 0, false
	}
	upN, downN := 0, 0
	for i := 1; i < len(keys); i++ {
		a, b := last[keys[i-1]], last[keys[i]]
		if a.NAV <= 0 || b.NAV <= 0 {
			continue
		}
		if b.NAV >= a.NAV {
			upN++
		} else {
			downN++
		}
	}
	total := upN + downN
	if total == 0 {
		return 0, 0, false
	}
	return float64(upN) * 100 / float64(total), float64(downN) * 100 / float64(total), true
}

// rollingReturns walks every NAV point at least `windowDays` days into
// the history and computes the point-to-point % return over that window.
// Returns best/worst/avg/median across the population.
func rollingReturns(hist []navPoint, windowDays int) *RollingStats {
	if len(hist) < 50 {
		return nil
	}
	cutoff := hist[len(hist)-1].When.AddDate(0, 0, -windowDays)
	if hist[0].When.After(cutoff) {
		// Not enough history for even one full window.
		return nil
	}
	rets := make([]float64, 0, len(hist)/2)
	histEnd := hist[len(hist)-1].When
	for _, start := range hist {
		end := start.When.AddDate(0, 0, windowDays)
		// Starts are chronologically sorted, so once one window's end
		// outruns history every subsequent start does too.
		if histEnd.Before(end) {
			break
		}
		ep, ok := navAt(hist, end)
		if !ok || start.NAV <= 0 || ep.NAV <= 0 {
			continue
		}
		r := (ep.NAV - start.NAV) / start.NAV * 100
		rets = append(rets, r)
	}
	if len(rets) == 0 {
		return nil
	}
	sort.Float64s(rets)
	sum := 0.0
	for _, r := range rets {
		sum += r
	}
	best := rets[len(rets)-1]
	worst := rets[0]
	avg := sum / float64(len(rets))
	median := rets[len(rets)/2]
	return &RollingStats{
		WindowDays:    windowDays,
		SampleCount:   len(rets),
		BestReturn:    best,
		WorstReturn:   worst,
		AverageReturn: avg,
		MedianReturn:  median,
	}
}

// metrics is the HTTP handler.
func (h *Handler) metrics(w http.ResponseWriter, r *http.Request) {
	ticker := strings.ToUpper(strings.TrimSpace(chi.URLParam(r, "ticker")))
	f, ok := h.svc.Find(ticker)
	if !ok {
		httpx.Error(w, r, httpx.ErrNotFound)
		return
	}
	out, err := h.metricsFor(r.Context(), f)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

