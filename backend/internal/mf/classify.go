package mf

import (
	"fmt"
	"strings"
)

// categoryOrder is the retail-app conventional ordering — what users
// expect to see in a category sidebar/filter.
var categoryOrder = []string{
	"Large Cap",
	"Mid Cap",
	"Small Cap",
	"Flexi Cap",
	"Multi Cap",
	"Large & Mid Cap",
	"Focused",
	"ELSS (Tax Saver)",
	"Aggressive Hybrid",
	"Conservative Hybrid",
	"Balanced Advantage",
	"Equity Savings",
	"Index",
	"ETF",
	"Sectoral / Thematic",
	"International",
	"Liquid",
	"Debt",
	"Gilt",
	"Arbitrage",
	"Solution Oriented",
}

// classify parses one mfapi directory row into a Fund. Returns ok=false
// to skip the row — used to filter out non-Direct plans, Dividend
// payout/reinvest options, and obvious junk rows.
//
// The shape of AMFI scheme names we rely on:
//
//	"<AMC> <Fund Name> - <Plan Type> Plan - <Option>"
//
// e.g. "Axis Bluechip Fund - Direct Plan - Growth"
//
// Edge cases the heuristics handle:
//   - Some names use "Direct Growth" / "Direct - Growth" without the
//     "Plan" word — the dual lc.Contains checks below cover that.
//   - "(Idcw)" / "Income Distribution Cum Capital Withdrawal" is the
//     post-2021 SEBI rename of Dividend — both filtered out.
//   - Index Direct Growth funds are tagged "Index" before the broader
//     Large Cap / etc. keywords run, since some index funds also contain
//     "Nifty 50" which would otherwise match Large Cap heuristics.
func classify(r directoryRow) (Fund, bool) {
	name := strings.TrimSpace(r.SchemeName)
	if name == "" || r.SchemeCode == 0 {
		return Fund{}, false
	}
	lc := strings.ToLower(name)

	// Direct Plan only — Regular plans charge a higher TER and we don't
	// want to surface both variants for the same underlying fund.
	if !strings.Contains(lc, "direct") {
		return Fund{}, false
	}
	// Growth option only — Dividend / IDCW funds distribute income which
	// makes "buy by amount → units" semantics confusing on this page.
	if strings.Contains(lc, "idcw") ||
		strings.Contains(lc, "dividend") ||
		strings.Contains(lc, "income distribution") ||
		strings.Contains(lc, "payout") ||
		strings.Contains(lc, "reinvest") {
		return Fund{}, false
	}
	if !strings.Contains(lc, "growth") {
		return Fund{}, false
	}

	cat := categoryFromName(lc)
	amc := amcFromName(name)

	return Fund{
		Ticker:     fmt.Sprintf("MF%d", r.SchemeCode),
		SchemeCode: r.SchemeCode,
		Name:       name,
		AMC:        amc,
		Category:   cat,
		PlanType:   "Direct",
		Option:     "Growth",
	}, true
}

// categoryFromName checks for the most-specific keyword first. Order
// matters here — "small cap index" should land under "Index", not "Small
// Cap"; "tax saver elss" should be ELSS regardless of what equity
// segment it implies.
func categoryFromName(lc string) string {
	switch {
	case containsAny(lc, "elss", "tax saver", "long term equity", "long-term equity"):
		return "ELSS (Tax Saver)"
	case containsAny(lc, "etf", "exchange traded"):
		return "ETF"
	case containsAny(lc, "index fund", "nifty index", "sensex index", "nifty 50 index", "nifty next 50 index"):
		return "Index"
	case containsAny(lc, "liquid"):
		return "Liquid"
	case containsAny(lc, "arbitrage"):
		return "Arbitrage"
	case containsAny(lc, "gilt"):
		return "Gilt"
	case containsAny(lc, "balanced advantage", "dynamic asset allocation"):
		return "Balanced Advantage"
	case containsAny(lc, "equity savings"):
		return "Equity Savings"
	case containsAny(lc, "aggressive hybrid", "equity hybrid", "equity & debt", "equity and debt", "hybrid equity"):
		return "Aggressive Hybrid"
	case containsAny(lc, "conservative hybrid"):
		return "Conservative Hybrid"
	case containsAny(lc, "children", "retirement"):
		return "Solution Oriented"
	case containsAny(lc, "us equity", "global", "international", "nasdaq", "s&p 500", "asia", "emerging markets"):
		return "International"
	case containsAny(lc, "banking", "pharma", "healthcare", "tech", "infra", "infrastructure", "energy",
		"consumption", "psu", "metal", "auto sector", "esg", "manufacturing", "pharmaceutical", "digital"):
		return "Sectoral / Thematic"
	case containsAny(lc, "small cap"):
		return "Small Cap"
	case containsAny(lc, "mid cap", "midcap", "emerging equit"):
		return "Mid Cap"
	case containsAny(lc, "large & mid", "large and mid"):
		return "Large & Mid Cap"
	case containsAny(lc, "large cap", "bluechip", "blue chip", "top 100", "top 200"):
		return "Large Cap"
	case containsAny(lc, "flexi cap", "flexicap"):
		return "Flexi Cap"
	case containsAny(lc, "multi cap", "multicap"):
		return "Multi Cap"
	case containsAny(lc, "focused"):
		return "Focused"
	case containsAny(lc, "duration", "income", "bond", "credit", "corporate", "money market", "savings", "overnight", "treasury", "floater", "debt"):
		return "Debt"
	default:
		// Default to a non-junk bucket so the fund still shows up under
		// some category header.
		return "Sectoral / Thematic"
	}
}

// amcFromName extracts the asset-management company name as the substring
// before " Mutual Fund" / " MF" / a hyphen separator. Cheap heuristic;
// good enough for grouping in the UI.
func amcFromName(name string) string {
	for _, sep := range []string{" Mutual Fund", " MF "} {
		if i := strings.Index(name, sep); i > 0 {
			return strings.TrimSpace(name[:i])
		}
	}
	if i := strings.Index(name, " - "); i > 0 {
		head := strings.TrimSpace(name[:i])
		// Cap at the first 2-3 words so "Axis Bluechip Fund" → "Axis"
		// rather than the whole fund name.
		fields := strings.Fields(head)
		if len(fields) > 0 {
			return fields[0]
		}
	}
	if fields := strings.Fields(name); len(fields) > 0 {
		return fields[0]
	}
	return ""
}

func containsAny(s string, needles ...string) bool {
	for _, n := range needles {
		if strings.Contains(s, n) {
			return true
		}
	}
	return false
}
