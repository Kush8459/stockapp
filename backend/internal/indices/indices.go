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
	Slug  string `json:"slug"`
	Label string `json:"label"`
	URL   string `json:"-"`
}

// Catalog is the set of indices we try to load. Order is what the UI
// dropdown shows.
var Catalog = []Index{
	{Slug: "nifty50", Label: "NIFTY 50", URL: "https://archives.nseindia.com/content/indices/ind_nifty50list.csv"},
	{Slug: "niftynext50", Label: "NIFTY Next 50", URL: "https://archives.nseindia.com/content/indices/ind_niftynext50list.csv"},
	{Slug: "nifty100", Label: "NIFTY 100", URL: "https://archives.nseindia.com/content/indices/ind_nifty100list.csv"},
	{Slug: "niftymidcap100", Label: "NIFTY Midcap 100", URL: "https://archives.nseindia.com/content/indices/ind_niftymidcap100list.csv"},
	{Slug: "nifty500", Label: "NIFTY 500", URL: "https://archives.nseindia.com/content/indices/ind_nifty500list.csv"},
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
			log.Warn().Str("slug", idx.Slug).Err(err).Msg("nse: index csv fetch failed")
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
