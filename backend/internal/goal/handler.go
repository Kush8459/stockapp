package goal

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
	r.Get("/goals", h.list)
	r.Post("/goals", h.create)
	r.Patch("/goals/{id}", h.update)
	r.Delete("/goals/{id}", h.delete)
}

type createReq struct {
	PortfolioID  string `json:"portfolioId"`
	Name         string `json:"name"`
	TargetAmount string `json:"targetAmount"`
	// ISO date "YYYY-MM-DD".
	TargetDate string `json:"targetDate"`
	Bucket     string `json:"bucket,omitempty"`
	Note       string `json:"note,omitempty"`
}

type updateReq struct {
	Name         *string `json:"name,omitempty"`
	TargetAmount *string `json:"targetAmount,omitempty"`
	TargetDate   *string `json:"targetDate,omitempty"`
	Bucket       *string `json:"bucket,omitempty"`
	Note         *string `json:"note,omitempty"`
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
	pid, err := uuid.Parse(req.PortfolioID)
	if err != nil {
		httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_portfolio", "invalid portfolio id"))
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || len(name) > 100 {
		httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_name", "name is required (1–100 chars)"))
		return
	}
	amount, err := decimal.NewFromString(req.TargetAmount)
	if err != nil || amount.Sign() <= 0 {
		httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_amount", "targetAmount must be a positive number"))
		return
	}
	date, err := time.Parse("2006-01-02", req.TargetDate)
	if err != nil {
		httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_date", "targetDate must be YYYY-MM-DD"))
		return
	}
	g, err := h.repo.Create(r.Context(), CreateInput{
		UserID:       userID,
		PortfolioID:  pid,
		Name:         name,
		TargetAmount: amount,
		TargetDate:   date,
		Bucket:       strings.TrimSpace(req.Bucket),
		Note:         strings.TrimSpace(req.Note),
	})
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, g)
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
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
	var req updateReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	in := UpdateInput{}
	if req.Name != nil {
		v := strings.TrimSpace(*req.Name)
		in.Name = &v
	}
	if req.TargetAmount != nil {
		amount, err := decimal.NewFromString(*req.TargetAmount)
		if err != nil || amount.Sign() <= 0 {
			httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_amount", "targetAmount must be a positive number"))
			return
		}
		in.TargetAmount = &amount
	}
	if req.TargetDate != nil {
		date, err := time.Parse("2006-01-02", *req.TargetDate)
		if err != nil {
			httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_date", "targetDate must be YYYY-MM-DD"))
			return
		}
		in.TargetDate = &date
	}
	if req.Bucket != nil {
		v := strings.TrimSpace(*req.Bucket)
		in.Bucket = &v
	}
	if req.Note != nil {
		v := strings.TrimSpace(*req.Note)
		in.Note = &v
	}
	g, err := h.repo.Update(r.Context(), userID, id, in)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.Error(w, r, httpx.ErrNotFound)
			return
		}
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, g)
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
