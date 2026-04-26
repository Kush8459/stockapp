package sip

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/stockapp/backend/internal/auth"
	"github.com/stockapp/backend/internal/httpx"
)

type Handler struct{ repo *Repo }

func NewHandler(repo *Repo) *Handler { return &Handler{repo: repo} }

func (h *Handler) Routes(r chi.Router) {
	r.Get("/sips", h.list)
	r.Post("/sips", h.create)
	r.Patch("/sips/{id}", h.updateStatus)
	r.Delete("/sips/{id}", h.cancel)
}

type createReq struct {
	PortfolioID string `json:"portfolioId"`
	Ticker      string `json:"ticker"`
	AssetType   string `json:"assetType"`
	Amount      string `json:"amount"`
	Frequency   string `json:"frequency"`
	FirstRunAt  string `json:"firstRunAt,omitempty"`
}

type statusReq struct {
	Status string `json:"status"`
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	userID, err := auth.RequireUser(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	plans, err := h.repo.ListByUser(r.Context(), userID)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": plans})
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
	pid, err := uuid.Parse(req.PortfolioID)
	if err != nil {
		httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_portfolio", "invalid portfolioId"))
		return
	}
	amount, err := decimal.NewFromString(req.Amount)
	if err != nil || amount.Sign() <= 0 {
		httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_amount", "amount must be > 0"))
		return
	}
	freq := Frequency(strings.ToLower(req.Frequency))
	switch freq {
	case FreqDaily, FreqWeekly, FreqMonthly:
	default:
		httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_frequency", "frequency must be daily|weekly|monthly"))
		return
	}
	first := time.Now().UTC()
	if req.FirstRunAt != "" {
		t, err := time.Parse(time.RFC3339, req.FirstRunAt)
		if err != nil {
			httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_first_run_at", "firstRunAt must be RFC3339"))
			return
		}
		first = t
	}
	assetType := strings.ToLower(req.AssetType)
	if assetType == "" {
		assetType = "stock"
	}

	p, err := h.repo.Create(r.Context(), CreateInput{
		UserID:      userID,
		PortfolioID: pid,
		Ticker:      strings.ToUpper(strings.TrimSpace(req.Ticker)),
		AssetType:   assetType,
		Amount:      amount,
		Frequency:   freq,
		FirstRunAt:  first,
	})
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, p)
}

func (h *Handler) updateStatus(w http.ResponseWriter, r *http.Request) {
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
	var req statusReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	status := Status(strings.ToLower(req.Status))
	switch status {
	case StatusActive, StatusPaused, StatusCancelled:
	default:
		httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_status", "status must be active|paused|cancelled"))
		return
	}
	if err := h.repo.SetStatus(r.Context(), userID, id, status); err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.Error(w, r, httpx.ErrNotFound)
			return
		}
		httpx.Error(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) cancel(w http.ResponseWriter, r *http.Request) {
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
	if err := h.repo.SetStatus(r.Context(), userID, id, StatusCancelled); err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.Error(w, r, httpx.ErrNotFound)
			return
		}
		httpx.Error(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
