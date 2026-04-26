package alert

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/stockapp/backend/internal/auth"
	"github.com/stockapp/backend/internal/httpx"
)

type Handler struct{ repo *Repo }

func NewHandler(repo *Repo) *Handler { return &Handler{repo: repo} }

func (h *Handler) Routes(r chi.Router) {
	r.Get("/alerts", h.list)
	r.Post("/alerts", h.create)
	r.Delete("/alerts/{id}", h.delete)
}

type createReq struct {
	Ticker      string `json:"ticker"`
	TargetPrice string `json:"targetPrice"`
	Direction   string `json:"direction"`
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	userID, err := auth.RequireUser(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	items, err := h.repo.ListByUser(r.Context(), userID)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	userID, err := auth.RequireUser(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	var req createReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	ticker := strings.ToUpper(strings.TrimSpace(req.Ticker))
	if ticker == "" {
		httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_ticker", "ticker required"))
		return
	}
	target, err := decimal.NewFromString(req.TargetPrice)
	if err != nil || target.Sign() <= 0 {
		httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_target", "target price must be > 0"))
		return
	}
	dir := Direction(strings.ToLower(req.Direction))
	if dir != DirAbove && dir != DirBelow {
		httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_direction", "direction must be above or below"))
		return
	}
	a, err := h.repo.Create(r.Context(), userID, ticker, target, dir)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, a)
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	userID, err := auth.RequireUser(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_id", "invalid id"))
		return
	}
	if err := h.repo.Delete(r.Context(), userID, id); err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.Error(w, r, httpx.ErrNotFound)
			return
		}
		httpx.Error(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
