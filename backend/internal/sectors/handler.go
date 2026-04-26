package sectors

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/stockapp/backend/internal/httpx"
	"github.com/stockapp/backend/internal/price"
)

// Handler exposes the sectoral index + component endpoints. Public — no auth
// required; sector data isn't user-specific.
type Handler struct {
	cache *price.Cache
}

func NewHandler(cache *price.Cache) *Handler {
	return &Handler{cache: cache}
}

func (h *Handler) Routes(r chi.Router) {
	r.Get("/sectors", h.list)
	r.Get("/sectors/{slug}", h.detail)
}

// SectorView is the per-row payload the right sidebar renders.
type SectorView struct {
	Name        string       `json:"name"`
	Slug        string       `json:"slug"`
	IndexTicker string       `json:"indexTicker"`
	Quote       *price.Quote `json:"quote,omitempty"`
}

// ComponentView is one stock cell in the heatmap.
type ComponentView struct {
	Ticker string       `json:"ticker"`
	Quote  *price.Quote `json:"quote,omitempty"`
}

// SectorDetail is what /sectors/{slug} returns: the sector itself, the
// index quote, and every component with its current quote.
type SectorDetail struct {
	Name        string          `json:"name"`
	Slug        string          `json:"slug"`
	IndexTicker string          `json:"indexTicker"`
	IndexQuote  *price.Quote    `json:"indexQuote,omitempty"`
	Components  []ComponentView `json:"components"`
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	// Batch-fetch every index quote in one MGET. We rely on the cache
	// having been populated by the WS feed + REST snapshot.
	tickers := make([]string, 0, len(All))
	for _, s := range All {
		tickers = append(tickers, s.IndexTicker)
	}
	quotes, err := h.cache.GetMany(r.Context(), tickers)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	out := make([]SectorView, 0, len(All))
	for _, s := range All {
		v := SectorView{Name: s.Name, Slug: s.Slug, IndexTicker: s.IndexTicker}
		if q, ok := quotes[s.IndexTicker]; ok {
			qq := q
			v.Quote = &qq
		}
		out = append(out, v)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (h *Handler) detail(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	s := BySlug(slug)
	if s == nil {
		httpx.Error(w, r, httpx.ErrNotFound)
		return
	}
	// One MGET for the index + every component.
	tickers := append([]string{s.IndexTicker}, s.Components...)
	quotes, err := h.cache.GetMany(r.Context(), tickers)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}

	det := SectorDetail{
		Name:        s.Name,
		Slug:        s.Slug,
		IndexTicker: s.IndexTicker,
		Components:  make([]ComponentView, 0, len(s.Components)),
	}
	if q, ok := quotes[s.IndexTicker]; ok {
		qq := q
		det.IndexQuote = &qq
	}
	for _, t := range s.Components {
		cv := ComponentView{Ticker: t}
		if q, ok := quotes[t]; ok {
			qq := q
			cv.Quote = &qq
		}
		det.Components = append(det.Components, cv)
	}
	httpx.JSON(w, http.StatusOK, det)
}
