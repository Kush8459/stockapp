package portfolio

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/stockapp/backend/internal/auth"
	"github.com/stockapp/backend/internal/httpx"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Routes(r chi.Router) {
	r.Get("/portfolios", h.list)
	r.Post("/portfolios", h.create)
	r.Patch("/portfolios/{id}", h.rename)
	r.Delete("/portfolios/{id}", h.delete)
	r.Get("/portfolios/{id}/holdings", h.holdings)
	r.Get("/portfolios/{id}/summary", h.summary)
	r.Get("/portfolios/{id}/timeseries", h.timeseries)
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	userID, err := auth.RequireUser(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	items, err := h.svc.List(r.Context(), userID)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) holdings(w http.ResponseWriter, r *http.Request) {
	p, err := h.authorizePortfolio(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	items, err := h.svc.EnrichedHoldings(r.Context(), p.ID)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) summary(w http.ResponseWriter, r *http.Request) {
	p, err := h.authorizePortfolio(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	sum, err := h.svc.Summary(r.Context(), p.ID)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, sum)
}

type nameReq struct {
	Name string `json:"name"`
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	userID, err := auth.RequireUser(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	var req nameReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_name", "name is required"))
		return
	}
	if len(name) > 100 {
		httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_name", "name max 100 chars"))
		return
	}
	p, err := h.svc.Create(r.Context(), userID, name)
	if err != nil {
		if errors.Is(err, ErrNameTaken) {
			httpx.Error(w, r, httpx.NewError(http.StatusConflict, "name_taken", "you already have a portfolio with that name"))
			return
		}
		// pgx may surface unique violations directly without going through repo.
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, p)
}

func (h *Handler) rename(w http.ResponseWriter, r *http.Request) {
	p, err := h.authorizePortfolio(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	var req nameReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_name", "name is required"))
		return
	}
	updated, err := h.svc.Rename(r.Context(), p.UserID, p.ID, name)
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httpx.Error(w, r, httpx.ErrNotFound)
		case errors.Is(err, ErrNameTaken):
			httpx.Error(w, r, httpx.NewError(http.StatusConflict, "name_taken", "you already have a portfolio with that name"))
		default:
			httpx.Error(w, r, err)
		}
		return
	}
	httpx.JSON(w, http.StatusOK, updated)
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	p, err := h.authorizePortfolio(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	if err := h.svc.Delete(r.Context(), p.UserID, p.ID); err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httpx.Error(w, r, httpx.ErrNotFound)
		case errors.Is(err, ErrPortfolioBusy):
			httpx.Error(w, r, httpx.NewError(http.StatusConflict, "portfolio_busy",
				"cannot delete: portfolio still has transactions, or it's your only portfolio"))
		default:
			httpx.Error(w, r, err)
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// timeseries returns a daily portfolio-value series replayed from
// transactions. Used by the dashboard's "vs benchmark" overlay.
func (h *Handler) timeseries(w http.ResponseWriter, r *http.Request) {
	p, err := h.authorizePortfolio(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	rng := ParseSeriesRange(r.URL.Query().Get("range"))
	series, err := h.svc.TimeSeries(r.Context(), p.ID, rng)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, series)
}

// authorizePortfolio loads the portfolio identified by the `id` URL param and
// ensures the requesting user owns it.
func (h *Handler) authorizePortfolio(r *http.Request) (*Portfolio, error) {
	userID, err := auth.RequireUser(r)
	if err != nil {
		return nil, err
	}
	raw := chi.URLParam(r, "id")
	pid, err := uuid.Parse(raw)
	if err != nil {
		return nil, httpx.NewError(http.StatusBadRequest, "bad_portfolio_id", "invalid portfolio id")
	}
	p, err := h.svc.repo.ByID(r.Context(), pid)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, httpx.ErrNotFound
		}
		return nil, err
	}
	if p.UserID != userID {
		return nil, httpx.ErrForbidden
	}
	return p, nil
}
