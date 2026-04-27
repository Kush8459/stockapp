// Package indices loads NSE's published index-constituent CSVs at startup
// and exposes them in-memory. Used by the price worker (to know which
// tickers to subscribe to) and the movers endpoint (to filter rankings by
// index membership: "show me top movers within NIFTY 50 only").
//
// CSVs come from https://archives.nseindia.com/content/indices/. Format:
//   Company Name,Industry,Symbol,Series,ISIN Code
//   Reliance Industries Ltd.,...,RELIANCE,EQ,INE002A01018
//
// We only need the Symbol column. Failed fetches log + continue; the
// hardcoded NIFTY 50 fallback keeps the worker functional even if NSE
// archives is unreachable.
package indices

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// Index identifies one NSE index by user-facing label + the slug used in
// query strings + the source URL.
type Index struct {
	Slug     string `json:"slug"`
	Label    string `json:"label"`
	Category string `json:"category"` // "broad" | "sector"
	URL      string `json:"-"`
}

// Catalog is the set of indices we try to load. Order is what the UI
// dropdown shows. Sectoral indices live alongside broad ones — both come
// from the same NSE archives endpoint, the same CSV format, the same
// load path. They're distinguished by the `Category` field so the UI
// can render two groups (Indices / Sectors) without a separate hardcoded
// per-sector ticker list.
var Catalog = []Index{
	// ── Broad ──
	{Slug: "nifty50", Category: "broad", Label: "NIFTY 50", URL: "https://archives.nseindia.com/content/indices/ind_nifty50list.csv"},
	{Slug: "niftynext50", Category: "broad", Label: "NIFTY Next 50", URL: "https://archives.nseindia.com/content/indices/ind_niftynext50list.csv"},
	{Slug: "nifty100", Category: "broad", Label: "NIFTY 100", URL: "https://archives.nseindia.com/content/indices/ind_nifty100list.csv"},
	{Slug: "niftymidcap100", Category: "broad", Label: "NIFTY Midcap 100", URL: "https://archives.nseindia.com/content/indices/ind_niftymidcap100list.csv"},
	{Slug: "nifty500", Category: "broad", Label: "NIFTY 500", URL: "https://archives.nseindia.com/content/indices/ind_nifty500list.csv"},

	// ── Sectoral — same NSE archives format, just per-sector CSVs ──
	{Slug: "niftybank", Category: "sector", Label: "Banking", URL: "https://archives.nseindia.com/content/indices/ind_niftybanklist.csv"},
	{Slug: "niftyit", Category: "sector", Label: "IT", URL: "https://archives.nseindia.com/content/indices/ind_niftyitlist.csv"},
	{Slug: "niftyauto", Category: "sector", Label: "Auto", URL: "https://archives.nseindia.com/content/indices/ind_niftyautolist.csv"},
	{Slug: "niftypharma", Category: "sector", Label: "Pharma", URL: "https://archives.nseindia.com/content/indices/ind_niftypharmalist.csv"},
	{Slug: "niftyfmcg", Category: "sector", Label: "FMCG", URL: "https://archives.nseindia.com/content/indices/ind_niftyfmcglist.csv"},
	{Slug: "niftymetal", Category: "sector", Label: "Metal", URL: "https://archives.nseindia.com/content/indices/ind_niftymetallist.csv"},
	{Slug: "niftyrealty", Category: "sector", Label: "Realty", URL: "https://archives.nseindia.com/content/indices/ind_niftyrealtylist.csv"},
	{Slug: "niftyenergy", Category: "sector", Label: "Energy", URL: "https://archives.nseindia.com/content/indices/ind_niftyenergylist.csv"},
	{Slug: "niftymedia", Category: "sector", Label: "Media", URL: "https://archives.nseindia.com/content/indices/ind_niftymedialist.csv"},
	{Slug: "niftypsubank", Category: "sector", Label: "PSU Bank", URL: "https://archives.nseindia.com/content/indices/ind_niftypsubanklist.csv"},
	{Slug: "niftyconsumerdurables", Category: "sector", Label: "Consumer Durables", URL: "https://archives.nseindia.com/content/indices/ind_niftyconsumerdurableslist.csv"},
	{Slug: "niftyhealthcare", Category: "sector", Label: "Healthcare", URL: "https://archives.nseindia.com/content/indices/ind_niftyhealthcarelist.csv"},
	{Slug: "niftyoilgas", Category: "sector", Label: "Oil & Gas", URL: "https://archives.nseindia.com/content/indices/ind_niftyoilgaslist.csv"},
}

// FallbackNIFTY50 is the published list as of early 2026. Used only when
// NSE archives is unreachable so the worker still has *something* to do.
var FallbackNIFTY50 = []string{
	"RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY", "HINDUNILVR", "ITC",
	"SBIN", "BAJFINANCE", "BHARTIARTL", "KOTAKBANK", "LT", "AXISBANK",
	"MARUTI", "ASIANPAINT", "DMART", "TITAN", "HCLTECH", "BAJAJFINSV",
	"WIPRO", "ULTRACEMCO", "M&M", "ADANIPORTS", "POWERGRID", "NTPC",
	"NESTLEIND", "ONGC", "TATAMOTORS", "JSWSTEEL", "TATASTEEL", "GRASIM",
	"INDUSINDBK", "TECHM", "SUNPHARMA", "HINDALCO", "DIVISLAB", "BAJAJ-AUTO",
	"BPCL", "BRITANNIA", "EICHERMOT", "DRREDDY", "CIPLA", "COALINDIA",
	"HEROMOTOCO", "ADANIENT", "UPL", "TATACONSUM", "APOLLOHOSP", "HDFCLIFE",
	"SBILIFE",
}

var (
	mu       sync.RWMutex
	bySlug   = map[string][]string{}
	bySet    = map[string]map[string]struct{}{} // for O(1) IsInIndex
	loadedAt time.Time
)

// errNotFound flags a 404 from NSE archives — the index URL is stale.
// Distinguished from generic fetch errors so the loader can demote the
// log severity (404 is expected, networking failures aren't).
var errNotFound = errors.New("nse: 404 Not Found")

// Tickers returns the constituent list for an index slug. nil if not loaded.
func Tickers(slug string) []string {
	mu.RLock()
	defer mu.RUnlock()
	return bySlug[slug]
}

// IsInIndex reports whether ticker is a constituent of slug. Both lookups
// are O(1).
func IsInIndex(ticker, slug string) bool {
	mu.RLock()
	defer mu.RUnlock()
	set, ok := bySet[slug]
	if !ok {
		return false
	}
	_, in := set[ticker]
	return in
}

// AllTickers returns every ticker across every loaded index, deduplicated.
// Used by the price worker to know what to subscribe to.
func AllTickers() []string {
	mu.RLock()
	defer mu.RUnlock()
	seen := make(map[string]struct{}, 600)
	for _, list := range bySlug {
		for _, t := range list {
			seen[t] = struct{}{}
		}
	}
	out := make([]string, 0, len(seen))
	for t := range seen {
		out = append(out, t)
	}
	return out
}

// LoadedAt returns when the catalog was last successfully refreshed.
func LoadedAt() time.Time {
	mu.RLock()
	defer mu.RUnlock()
	return loadedAt
}

// LoadAll fetches every index's CSV and replaces the in-memory catalog.
// Best-effort: a failure on one index doesn't prevent others from loading.
// If NIFTY 50 itself fails, FallbackNIFTY50 is used so the worker has at
// least the bluest of blue chips to subscribe to.
func LoadAll(ctx context.Context) {
	next := make(map[string][]string, len(Catalog))

	for _, idx := range Catalog {
		tickers, err := fetchIndexCSV(ctx, idx.URL)
		if err != nil {
			// 404s mean NSE renamed/retired the archive. The categories
			// endpoint already filters those out so users never see a
			// dead chip — log at DEBUG to keep the steady-state log
			// quiet; promote to WARN for genuinely unexpected failures.
			ev := log.Warn()
			if errors.Is(err, errNotFound) {
				ev = log.Debug()
			}
			ev.Str("slug", idx.Slug).Err(err).Msg("nse: index csv fetch failed")
			continue
		}
		next[idx.Slug] = tickers
		log.Info().Str("slug", idx.Slug).Int("count", len(tickers)).Msg("nse: index loaded")
	}

	if _, ok := next["nifty50"]; !ok {
		log.Warn().Int("count", len(FallbackNIFTY50)).Msg("nse: using hardcoded NIFTY 50 fallback")
		next["nifty50"] = FallbackNIFTY50
	}

	// Build the lookup sets.
	sets := make(map[string]map[string]struct{}, len(next))
	for slug, list := range next {
		s := make(map[string]struct{}, len(list))
		for _, t := range list {
			s[t] = struct{}{}
		}
		sets[slug] = s
	}

	mu.Lock()
	bySlug = next
	bySet = sets
	loadedAt = time.Now()
	mu.Unlock()
}

func fetchIndexCSV(ctx context.Context, url string) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "stockapp/0.1 (+https://github.com/stockapp)")
	req.Header.Set("Accept", "text/csv,*/*")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, errNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("nse: %s", resp.Status)
	}

	r := csv.NewReader(resp.Body)
	r.FieldsPerRecord = -1

	header, err := r.Read()
	if err != nil {
		return nil, err
	}
	symCol := -1
	for i, h := range header {
		if strings.EqualFold(strings.TrimSpace(h), "Symbol") {
			symCol = i
			break
		}
	}
	if symCol < 0 {
		return nil, errors.New("no Symbol column in CSV")
	}

	tickers := make([]string, 0, 128)
	for {
		rec, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}
		if symCol >= len(rec) {
			continue
		}
		sym := strings.TrimSpace(rec[symCol])
		if sym == "" {
			continue
		}
		tickers = append(tickers, sym)
	}
	return tickers, nil
}
