package price

import (
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"

	"github.com/stockapp/backend/internal/httpx"
)

// Handler exposes price read endpoints for the UI.
type Handler struct {
	cache *Cache
	rdb   *redis.Client
}

func NewHandler(cache *Cache, rdb *redis.Client) *Handler {
	return &Handler{cache: cache, rdb: rdb}
}

func (h *Handler) Routes(r chi.Router) {
	r.Get("/quotes", h.quotes)
	r.Get("/quotes/{ticker}", h.quote)
	r.Get("/quotes/{ticker}/history", h.history)
	r.Get("/quotes/{ticker}/candles", h.candles)
	r.Get("/universe", h.universe)
	r.Get("/search", h.search)
}

func (h *Handler) quotes(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query().Get("tickers")
	if raw == "" {
		httpx.JSON(w, http.StatusOK, map[string]any{"items": []Quote{}})
		return
	}
	parts := strings.Split(raw, ",")
	for i := range parts {
		parts[i] = strings.ToUpper(strings.TrimSpace(parts[i]))
	}
	quotes, err := h.cache.GetMany(r.Context(), parts)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	list := make([]Quote, 0, len(quotes))
	for _, q := range quotes {
		list = append(list, q)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Ticker < list[j].Ticker })
	httpx.JSON(w, http.StatusOK, map[string]any{"items": list})
}

func (h *Handler) quote(w http.ResponseWriter, r *http.Request) {
	t := strings.ToUpper(chi.URLParam(r, "ticker"))
	q, err := h.cache.Get(r.Context(), t)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	if q == nil {
		httpx.Error(w, r, httpx.ErrNotFound)
		return
	}
	httpx.JSON(w, http.StatusOK, q)
}

func (h *Handler) history(w http.ResponseWriter, r *http.Request) {
	t := strings.ToUpper(chi.URLParam(r, "ticker"))
	limit := 120
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	items, err := h.cache.History(r.Context(), t, limit)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ticker": t, "items": items})
}

// candles returns historical OHLC bars for a ticker. Routes to mfapi.in for
// known mutual-fund scheme tickers and Yahoo Finance for everything else.
func (h *Handler) candles(w http.ResponseWriter, r *http.Request) {
	ticker := strings.ToUpper(chi.URLParam(r, "ticker"))
	rng := ParseRange(r.URL.Query().Get("range"))

	var (
		items []Candle
		err   error
	)
	if _, isMF := MFSchemes[ticker]; isMF {
		items, err = HistoryMF(r.Context(), h.rdb, ticker, rng)
	} else {
		items, err = HistoryYahoo(r.Context(), h.rdb, ticker, rng)
	}
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"ticker": ticker,
		"range":  rng,
		"items":  items,
	})
}

func (h *Handler) search(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	limit := 10
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	items, err := Search(r.Context(), h.rdb, q, limit)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) universe(w http.ResponseWriter, r *http.Request) {
	list := make([]string, 0, len(MockUniverse))
	for k := range MockUniverse {
		list = append(list, k)
	}
	sort.Strings(list)
	httpx.JSON(w, http.StatusOK, map[string]any{"tickers": list})
}
