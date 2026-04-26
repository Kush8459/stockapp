package portfolio

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/stockapp/backend/internal/auth"
	"github.com/stockapp/backend/internal/httpx"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Routes(r chi.Router) {
	r.Get("/portfolios", h.list)
	r.Get("/portfolios/{id}/holdings", h.holdings)
	r.Get("/portfolios/{id}/summary", h.summary)
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
