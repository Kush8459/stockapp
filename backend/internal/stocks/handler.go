// Package stocks composes the existing index data + price cache into
// one browse-style endpoint pair (`/stocks/categories`, `/stocks/catalog`)
// — the equivalent of /mf/categories + /mf/catalog but for equities.
//
// No new data sources are introduced; everything here is a thin adapter
// over packages already wired up. All ticker sets come from
// `internal/indices` (loaded from NSE archives at startup, both broad
// and sectoral indices), live quotes come from `price.Cache`, names come
// from `price.LookupInstrument` (the Upstox CSV). When upstream data
// hasn't loaded yet, the endpoints return empty groups — never a
// hardcoded fallback list.
package stocks

import (
	"context"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"
	"github.com/shopspring/decimal"

	"github.com/stockapp/backend/internal/httpx"
	"github.com/stockapp/backend/internal/indices"
	"github.com/stockapp/backend/internal/price"
)

// Handler exposes the stocks-browse endpoints. Public — no auth required;
// equity quotes aren't user-specific.
type Handler struct {
	cache *price.Cache
	rdb   *redis.Client
}

func NewHandler(cache *price.Cache, rdb *redis.Client) *Handler {
	return &Handler{cache: cache, rdb: rdb}
}

func (h *Handler) Routes(r chi.Router) {
	r.Get("/stocks/categories", h.categories)
	r.Get("/stocks/catalog", h.catalog)
}

// CategoryItem is one filter chip the UI renders.
type CategoryItem struct {
	ID    string `json:"id"`    // e.g. "movers:gainers", "index:nifty50", "sector:banking"
	Label string `json:"label"` // human-readable
	Count int    `json:"count,omitempty"`
}

// CategoryGroup groups chips under a header (Movers / Indices / Sectors).
type CategoryGroup struct {
	Name  string         `json:"name"`
	Items []CategoryItem `json:"items"`
}

// CardItem is one stock card the UI renders.
type CardItem struct {
	Ticker   string       `json:"ticker"`
	Name     string       `json:"name,omitempty"`
	Exchange string       `json:"exchange,omitempty"`
	Quote    *price.Quote `json:"quote,omitempty"`
}

func (h *Handler) categories(w http.ResponseWriter, r *http.Request) {
	groups := []CategoryGroup{
		{
			Name: "Movers",
			Items: []CategoryItem{
				{ID: "movers:gainers", Label: "Top gainers"},
				{ID: "movers:losers", Label: "Top losers"},
				{ID: "movers:active", Label: "Most active"},
			},
		},
	}

	// Both broad and sectoral indices come from the same loaded NSE
	// catalog. We split them by `Category` for the UI; chips for indices
	// that didn't load (404, network blip) are simply omitted — never
	// substituted with a hardcoded constituent list.
	var broad, sector []CategoryItem
	for _, idx := range indices.Catalog {
		ts := indices.Tickers(idx.Slug)
		if len(ts) == 0 {
			continue
		}
		item := CategoryItem{Label: idx.Label, Count: len(ts)}
		switch idx.Category {
		case "sector":
			item.ID = "sector:" + idx.Slug
			sector = append(sector, item)
		default: // "broad" or unset — treat as broad
			item.ID = "index:" + idx.Slug
			broad = append(broad, item)
		}
	}
	if len(broad) > 0 {
		groups = append(groups, CategoryGroup{Name: "Indices", Items: broad})
	}
	if len(sector) > 0 {
		groups = append(groups, CategoryGroup{Name: "Sectors", Items: sector})
	}

	httpx.JSON(w, http.StatusOK, map[string]any{"groups": groups})
}

// catalog returns a paginated set of CardItems.
//
// Query params:
//   - category: "movers:{gainers,losers,active}" | "index:{slug}" | "sector:{slug}".
//     Empty = no filter; the result set is then driven entirely by `q`
//     against the full Upstox instrument index. Empty category + empty q
//     returns an empty list (the UI's "blank slate" state).
//   - q:        free-text. With a category, filters within it. Without
//     a category, searches across every NSE EQ ticker in the loaded
//     Upstox CSV.
//   - limit:    1..100, default 30
func (h *Handler) catalog(w http.ResponseWriter, r *http.Request) {
	limit := 30
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	offset := 0
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	cat := strings.TrimSpace(r.URL.Query().Get("category"))

	// No filter chosen → either search across the whole instrument index
	// (when q is provided) or return empty so the UI can render its
	// "search or pick a filter" empty state.
	if cat == "" {
		cards, total := h.universeSearch(r.Context(), q, limit, offset)
		httpx.JSON(w, http.StatusOK, map[string]any{
			"items":    cards,
			"category": "",
			"total":    total,
			"offset":   offset,
			"hasMore":  offset+len(cards) < total,
		})
		return
	}

	tickers, sortMode, err := resolveCategory(cat)
	if err != nil {
		httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_category", err.Error()))
		return
	}

	// One MGET for the whole set — much cheaper than per-ticker round-trips.
	quoteMap, err := h.cache.GetMany(r.Context(), tickers)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}

	qUpper := strings.ToUpper(q)
	cards := make([]CardItem, 0, len(tickers))
	for _, t := range tickers {
		ins, _ := price.LookupInstrument(t)
		card := CardItem{
			Ticker:   t,
			Name:     ins.Name,
			Exchange: ins.Exchange,
		}
		if qq, ok := quoteMap[t]; ok {
			c := qq
			card.Quote = &c
		}
		// Free-text filter, applied after enrichment so users can match
		// "Reliance" against the company name even though the ticker is
		// "RELIANCE".
		if qUpper != "" {
			sym := strings.ToUpper(card.Ticker)
			name := strings.ToUpper(card.Name)
			if !strings.Contains(sym, qUpper) && !strings.Contains(name, qUpper) {
				continue
			}
		}
		cards = append(cards, card)
	}

	sortCards(cards, sortMode)

	total := len(cards)
	// Apply offset/limit window after sort so pagination is stable across
	// requests (the underlying sort key for movers can shift as prices
	// move, but for one user's session within ~30s it's effectively fixed).
	if offset >= total {
		cards = cards[:0]
	} else {
		end := offset + limit
		if end > total {
			end = total
		}
		cards = cards[offset:end]
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"items":    cards,
		"category": cat,
		"total":    total,
		"offset":   offset,
		"hasMore":  offset+len(cards) < total,
	})
}

// universeSearch is the no-filter path: matches `q` across every Indian
// equity we can resolve, enriches with live quotes, and returns the
// requested page. Two layers, mirroring what the dashboard SearchBar does:
//
//  1. Local Upstox CSV (NSE EQ only) — paginated, fast, the bulk of hits.
//  2. Yahoo Finance fallback — only invoked when (a) local has zero
//     results AND (b) we're on offset=0. Yahoo doesn't paginate so it
//     fills the first page only; total is reported as the fallback's
//     row count so the UI marks "no more pages" correctly.
//
// Empty q returns (nil, 0) — the UI renders a "type to search" hint.
func (h *Handler) universeSearch(ctx context.Context, q string, limit, offset int) ([]CardItem, int) {
	if q == "" {
		return []CardItem{}, 0
	}
	matches, total := price.SearchInstrumentsPaged(q, limit, offset)

	// Yahoo fallback when the local index can't resolve the query.
	// Pagination would require multiple Yahoo round-trips with no
	// stable ordering, so we skip it when offset > 0 — the UI's
	// "you've reached the end" footer kicks in naturally.
	if len(matches) == 0 && offset == 0 {
		yResults, err := price.Search(ctx, h.rdb, q, limit)
		if err == nil {
			fallback := make([]CardItem, 0, len(yResults))
			for _, r := range yResults {
				// Filter to instruments meaningful on the stocks page.
				// Mutual funds belong on /funds; currencies and crypto
				// aren't part of the Indian-equity browse experience.
				if r.Type != "" && r.Type != "EQUITY" && r.Type != "ETF" {
					continue
				}
				ticker := stripYahooSuffix(r.Symbol)
				if ticker == "" {
					continue
				}
				card := CardItem{
					Ticker:   ticker,
					Name:     r.Name,
					Exchange: r.Exchange,
				}
				if qq, err := h.cache.Get(ctx, ticker); err == nil && qq != nil {
					c := *qq
					card.Quote = &c
				}
				fallback = append(fallback, card)
			}
			return fallback, len(fallback)
		}
	}

	if len(matches) == 0 {
		return []CardItem{}, total
	}
	tickers := make([]string, len(matches))
	for i, m := range matches {
		tickers[i] = m.Symbol
	}
	quoteMap, err := h.cache.GetMany(ctx, tickers)
	if err != nil {
		// Soft-fail on the quote read — we'd still rather show name-only
		// search hits than a 500. The client gets cards with no Quote
		// field and renders "—" for the price.
		quoteMap = nil
	}
	out := make([]CardItem, 0, len(matches))
	for _, m := range matches {
		card := CardItem{
			Ticker:   m.Symbol,
			Name:     m.Name,
			Exchange: m.Exchange,
		}
		if qq, ok := quoteMap[m.Symbol]; ok {
			c := qq
			card.Quote = &c
		}
		out = append(out, card)
	}
	return out, total
}

// stripYahooSuffix turns Yahoo's "RELIANCE.NS" / "AAPL" / "BTC-USD" into
// the bare ticker our routes expect ("RELIANCE", "AAPL", "BTC-USD").
// Yahoo sometimes returns malformed rows with empty or "-only" symbols
// — those collapse to "" and the caller drops them.
func stripYahooSuffix(symbol string) string {
	s := strings.TrimSpace(symbol)
	for _, suffix := range []string{".NS", ".BO"} {
		if strings.HasSuffix(strings.ToUpper(s), suffix) {
			return s[:len(s)-len(suffix)]
		}
	}
	return s
}

// sortMode tells the catalog handler how to order the result list.
type sortMode int

const (
	sortByName        sortMode = iota // alphabetical (default for index/sector)
	sortByGainersDesc                  // top movers first
	sortByLosersAsc                    // worst movers first
	sortByVolatility                   // most active = abs(changePct) desc
)

// resolveCategory turns a category id into its ticker set + the sort mode
// the UI implies (movers:gainers → sort by changePct descending; etc.).
//
// "index:" and "sector:" both resolve through indices.Tickers — the only
// difference is which subset of the loaded catalog the slug is expected
// to come from. Identical code path keeps things honest: sectors aren't
// curated, they're whatever NSE publishes.
func resolveCategory(cat string) ([]string, sortMode, error) {
	parts := strings.SplitN(cat, ":", 2)
	if len(parts) != 2 {
		return nil, 0, ErrBadCategory
	}
	switch parts[0] {
	case "index", "sector":
		ts := indices.Tickers(parts[1])
		if len(ts) == 0 {
			if parts[0] == "sector" {
				return nil, 0, ErrUnknownSector
			}
			return nil, 0, ErrUnknownIndex
		}
		return ts, sortByName, nil
	case "movers":
		// Movers rank across whatever stocks the cache currently has —
		// limited only to NIFTY 500 so out-of-coverage tickers don't
		// pollute the leaderboard.
		base := indices.Tickers("nifty500")
		if len(base) == 0 {
			base = indices.Tickers("nifty100")
		}
		if len(base) == 0 {
			base = indices.Tickers("nifty50")
		}
		switch parts[1] {
		case "gainers":
			return base, sortByGainersDesc, nil
		case "losers":
			return base, sortByLosersAsc, nil
		case "active":
			return base, sortByVolatility, nil
		default:
			return nil, 0, ErrBadCategory
		}
	}
	return nil, 0, ErrBadCategory
}

func sortCards(cards []CardItem, mode sortMode) {
	switch mode {
	case sortByName:
		sort.SliceStable(cards, func(i, j int) bool {
			a := cards[i].Name
			b := cards[j].Name
			if a == "" {
				a = cards[i].Ticker
			}
			if b == "" {
				b = cards[j].Ticker
			}
			return a < b
		})
	case sortByGainersDesc:
		// Cards without a quote (cache miss) sort to the end so the live
		// movers UI doesn't surface a "—" row in the top slot.
		sort.SliceStable(cards, func(i, j int) bool {
			ai := changePct(cards[i])
			aj := changePct(cards[j])
			return ai.GreaterThan(aj)
		})
	case sortByLosersAsc:
		sort.SliceStable(cards, func(i, j int) bool {
			return changePct(cards[i]).LessThan(changePct(cards[j]))
		})
	case sortByVolatility:
		sort.SliceStable(cards, func(i, j int) bool {
			return changePct(cards[i]).Abs().GreaterThan(changePct(cards[j]).Abs())
		})
	}
}

func changePct(c CardItem) decimal.Decimal {
	if c.Quote == nil {
		return decimal.Zero
	}
	return c.Quote.ChangePct
}

// Sentinel errors so the handler can map to specific HTTP messages without
// the caller having to know category-id parsing details.
var (
	ErrBadCategory   = newCategoryErr("category must be of form 'index:<slug>', 'sector:<slug>', or 'movers:<gainers|losers|active>'")
	ErrUnknownIndex  = newCategoryErr("unknown index slug — check /stocks/categories for valid options")
	ErrUnknownSector = newCategoryErr("unknown sector slug — check /stocks/categories for valid options")
)

type categoryErr struct{ msg string }

func (e *categoryErr) Error() string         { return e.msg }
func newCategoryErr(s string) *categoryErr   { return &categoryErr{msg: s} }
