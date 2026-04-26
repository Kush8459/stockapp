// Package sectors maps NSE sectoral indices to their component stocks.
// Used by the right sidebar (list of sectors with live prices) and the
// sector heatmap drill-down (component stocks coloured by day-change).
//
// Component lists are the top ~5 weights per sector — enough for a useful
// heatmap without needing the entire index basket. Update if you add more
// stocks to internal/price/upstox.go.
package sectors

// Sector is one sectoral index plus its component stocks.
type Sector struct {
	Name        string   `json:"name"`        // user-facing label, e.g. "Banking"
	Slug        string   `json:"slug"`        // URL slug, e.g. "banking"
	IndexTicker string   `json:"indexTicker"` // ticker for the sector's index
	Components  []string `json:"components"`  // top constituent tickers
}

// All returns every sector in display order. The order here drives the
// right-sidebar layout, so put the heaviest / most-watched first.
var All = []Sector{
	{
		Name:        "Banking",
		Slug:        "banking",
		IndexTicker: "BANKNIFTY",
		Components:  []string{"HDFCBANK", "ICICIBANK", "AXISBANK", "KOTAKBANK", "SBIN"},
	},
	{
		Name:        "IT",
		Slug:        "it",
		IndexTicker: "NIFTYIT",
		Components:  []string{"TCS", "INFY", "WIPRO", "HCLTECH", "TECHM"},
	},
	{
		Name:        "Auto",
		Slug:        "auto",
		IndexTicker: "NIFTYAUTO",
		Components:  []string{"MARUTI", "TATAMOTORS", "M&M", "BAJAJ-AUTO", "HEROMOTOCO"},
	},
	{
		Name:        "Pharma",
		Slug:        "pharma",
		IndexTicker: "NIFTYPHARMA",
		Components:  []string{"SUNPHARMA", "DRREDDY", "CIPLA", "DIVISLAB"},
	},
	{
		Name:        "FMCG",
		Slug:        "fmcg",
		IndexTicker: "NIFTYFMCG",
		Components:  []string{"ITC", "HINDUNILVR", "NESTLEIND", "BRITANNIA", "DABUR"},
	},
	{
		Name:        "Metals",
		Slug:        "metals",
		IndexTicker: "NIFTYMETAL",
		Components:  []string{"TATASTEEL", "JSWSTEEL", "HINDALCO", "VEDL", "COALINDIA"},
	},
	{
		Name:        "Energy",
		Slug:        "energy",
		IndexTicker: "NIFTYENERGY",
		Components:  []string{"RELIANCE", "ONGC", "NTPC", "POWERGRID", "COALINDIA"},
	},
	{
		Name:        "Financial Services",
		Slug:        "finsrv",
		IndexTicker: "NIFTYFINSRV",
		Components:  []string{"HDFCBANK", "ICICIBANK", "AXISBANK", "KOTAKBANK", "SBIN"},
	},
	{
		Name:        "Realty",
		Slug:        "realty",
		IndexTicker: "NIFTYREALTY",
		// No realty components in our universe yet — sidebar still shows the
		// index price; heatmap will be empty until tickers are added.
		Components: []string{},
	},
	{
		Name:        "Media",
		Slug:        "media",
		IndexTicker: "NIFTYMEDIA",
		Components:  []string{},
	},
	{
		Name:        "PSU Banks",
		Slug:        "psubank",
		IndexTicker: "NIFTYPSUBANK",
		Components:  []string{"SBIN"},
	},
}

// BySlug returns the sector with the given slug, or nil.
func BySlug(slug string) *Sector {
	for i := range All {
		if All[i].Slug == slug {
			return &All[i]
		}
	}
	return nil
}
