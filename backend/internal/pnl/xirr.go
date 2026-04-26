// Package pnl holds return-calculation primitives. XIRR is the headline one.
package pnl

import (
	"errors"
	"math"
	"time"
)

// CashFlow is one dated cash movement. Buys are negative (money leaving the
// wallet), sells are positive, and the terminal current-value of the holdings
// goes in as a positive flow at the valuation date.
type CashFlow struct {
	When   time.Time
	Amount float64
}

// XIRR returns the annualized internal rate of return for an arbitrary set
// of cash flows, computed with Newton–Raphson and a bisection fallback.
//
// Returns a fraction (e.g. 0.127 for 12.7%).
func XIRR(flows []CashFlow) (float64, error) {
	if len(flows) < 2 {
		return 0, errors.New("need at least 2 cash flows")
	}
	hasNeg, hasPos := false, false
	for _, f := range flows {
		if f.Amount < 0 {
			hasNeg = true
		} else if f.Amount > 0 {
			hasPos = true
		}
	}
	if !hasNeg || !hasPos {
		return 0, errors.New("cash flows must contain at least one negative and one positive amount")
	}

	t0 := flows[0].When
	years := func(t time.Time) float64 {
		return t.Sub(t0).Hours() / 24 / 365.0
	}

	npv := func(rate float64) float64 {
		var s float64
		for _, f := range flows {
			s += f.Amount / math.Pow(1+rate, years(f.When))
		}
		return s
	}
	dnpv := func(rate float64) float64 {
		var s float64
		for _, f := range flows {
			y := years(f.When)
			s -= y * f.Amount / math.Pow(1+rate, y+1)
		}
		return s
	}

	// Newton–Raphson from a reasonable start.
	rate := 0.1
	for i := 0; i < 50; i++ {
		f := npv(rate)
		if math.Abs(f) < 1e-7 {
			return rate, nil
		}
		df := dnpv(rate)
		if df == 0 {
			break
		}
		next := rate - f/df
		if math.IsNaN(next) || math.IsInf(next, 0) {
			break
		}
		if math.Abs(next-rate) < 1e-9 {
			return next, nil
		}
		rate = next
	}

	// Fallback: bisection on a wide bracket.
	lo, hi := -0.999, 10.0
	fl, fh := npv(lo), npv(hi)
	if fl*fh > 0 {
		return 0, errors.New("could not bracket a root")
	}
	for i := 0; i < 200; i++ {
		mid := (lo + hi) / 2
		fm := npv(mid)
		if math.Abs(fm) < 1e-7 {
			return mid, nil
		}
		if fl*fm < 0 {
			hi, fh = mid, fm
		} else {
			lo, fl = mid, fm
		}
	}
	return (lo + hi) / 2, nil
}
