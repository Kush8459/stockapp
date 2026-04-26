package market

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/shopspring/decimal"

	"github.com/stockapp/backend/internal/httpx"
	"github.com/stockapp/backend/internal/indices"
	"github.com/stockapp/backend/internal/price"
)

// Handler exposes the market-context endpoints. Public — no auth required;
// market hours aren't user-specific.
type Handler struct {
	cache *price.Cache
}

func NewHandler(cache *price.Cache) *Handler {
	return &Handler{cache: cache}
}

func (h *Handler) Routes(r chi.Router) {
	r.Get("/market/status", h.status)
	r.Get("/market/holidays", h.holidays)
	r.Get("/market/movers", h.movers)
	r.Get("/market/indices", h.indices)
}

// indices lists every NSE index slug + label available for the movers
// filter. Empty list during the first ~10 s of startup before LoadAll
// completes — UI should treat that as "All only" until populated.
func (h *Handler) indices(w http.ResponseWriter, r *http.Request) {
	out := make([]indices.Index, 0, len(indices.Catalog))
	for _, idx := range indices.Catalog {
		// Only expose indices we successfully loaded — saves the UI from
		// rendering a dropdown option that returns empty.
		if len(indices.Tickers(idx.Slug)) == 0 {
			continue
		}
		out = append(out, indices.Index{Slug: idx.Slug, Label: idx.Label})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (h *Handler) status(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, CurrentStatus(time.Now()))
}

// holidays returns the configured NSE holiday calendar so the UI can show a
// "next holiday" hint or render a calendar pill.
func (h *Handler) holidays(w http.ResponseWriter, r *http.Request) {
	type item struct {
		Date time.Time `json:"date"`
		Name string    `json:"name"`
	}
	out := make([]item, 0, len(Holidays2026))
	for _, h := range Holidays2026 {
		out = append(out, item{Date: h.Date, Name: h.Name})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

// movers returns top-N day gainers and losers across every stock currently
// in the price cache. Indices and mutual funds are filtered out — we want
// equities only.
//
// Query params:
//   - limit: how many gainers + losers to return (default 5, max 20)
//   - index: optional slug (nifty50/nifty100/niftymidcap100/nifty500/…)
//     restricts the ranking pool to that index's constituents. Empty =
//     ranking across every cached stock.
func (h *Handler) movers(w http.ResponseWriter, r *http.Request) {
	limit := 5
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 20 {
			limit = n
		}
	}
	indexSlug := strings.TrimSpace(r.URL.Query().Get("index"))

	all, err := h.cache.AllKnown(r.Context())
	if err != nil {
		httpx.Error(w, r, err)
		return
	}

	stocks := make([]price.Quote, 0, len(all))
	for _, q := range all {
		if !isStockTicker(q.Ticker) {
			continue
		}
		if indexSlug != "" && !indices.IsInIndex(q.Ticker, indexSlug) {
			continue
		}
		stocks = append(stocks, q)
	}

	// Sort descending by changePct. Top of slice = gainers, bottom = losers.
	sort.SliceStable(stocks, func(i, j int) bool {
		return stocks[i].ChangePct.GreaterThan(stocks[j].ChangePct)
	})

	gainers := topN(stocks, limit, true)
	losers := topN(stocks, limit, false)

	httpx.JSON(w, http.StatusOK, map[string]any{
		"gainers": gainers,
		"losers":  losers,
		"total":   len(stocks),
	})
}

// topN returns the first or last `n` quotes that actually moved (changePct
// != 0). When `top` is true → biggest gainers; otherwise biggest losers,
// re-sorted ascending so the worst is shown first.
func topN(sorted []price.Quote, n int, top bool) []price.Quote {
	zero := decimal.Zero
	out := make([]price.Quote, 0, n)
	if top {
		for _, q := range sorted {
			if q.ChangePct.GreaterThan(zero) && len(out) < n {
				out = append(out, q)
			}
		}
		return out
	}
	// losers: walk from the bottom backwards, then reverse so the worst is first.
	for i := len(sorted) - 1; i >= 0 && len(out) < n; i-- {
		if sorted[i].ChangePct.LessThan(zero) {
			out = append(out, sorted[i])
		}
	}
	return out
}

// isStockTicker returns true for NSE EQ tickers — used to filter the
// movers list. Indices live in price.UpstoxInstrumentKeys with NSE_INDEX or
// BSE_INDEX prefixes; MFs are in price.MFSchemes.
func isStockTicker(ticker string) bool {
	if _, mf := price.MFSchemes[ticker]; mf {
		return false
	}
	key, ok := price.LookupUpstoxKey(ticker)
	if ok && (strings.HasPrefix(key, "NSE_INDEX") || strings.HasPrefix(key, "BSE_INDEX")) {
		return false
	}
	return true
}
