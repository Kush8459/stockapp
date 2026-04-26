package pnl

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/stockapp/backend/internal/auth"
	"github.com/stockapp/backend/internal/httpx"
)

// Handler wires XIRR endpoints into the authenticated route group.
type Handler struct {
	db  *pgxpool.Pool
	svc *Service
}

func NewHandler(db *pgxpool.Pool, svc *Service) *Handler {
	return &Handler{db: db, svc: svc}
}

func (h *Handler) Routes(r chi.Router) {
	r.Get("/portfolios/{id}/xirr", h.portfolio)
	r.Get("/portfolios/{id}/holdings/{ticker}/xirr", h.holding)
}

func (h *Handler) portfolio(w http.ResponseWriter, r *http.Request) {
	userID, err := auth.RequireUser(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	pid, err := h.authorize(r, userID)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	res, err := h.svc.PortfolioXIRR(r.Context(), pid)
	writeXIRR(w, r, res, err)
}

func (h *Handler) holding(w http.ResponseWriter, r *http.Request) {
	userID, err := auth.RequireUser(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	pid, err := h.authorize(r, userID)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	ticker := strings.ToUpper(chi.URLParam(r, "ticker"))
	if ticker == "" {
		httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_ticker", "ticker required"))
		return
	}
	res, err := h.svc.HoldingXIRR(r.Context(), pid, ticker)
	writeXIRR(w, r, res, err)
}

// authorize verifies the portfolio id in the URL belongs to the caller.
func (h *Handler) authorize(r *http.Request, userID uuid.UUID) (uuid.UUID, error) {
	raw := chi.URLParam(r, "id")
	pid, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, httpx.NewError(http.StatusBadRequest, "bad_portfolio_id", "invalid portfolio id")
	}
	var owner uuid.UUID
	err = h.db.QueryRow(r.Context(), `SELECT user_id FROM portfolios WHERE id = $1`, pid).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, httpx.ErrNotFound
	}
	if err != nil {
		return uuid.Nil, err
	}
	if owner != userID {
		return uuid.Nil, httpx.ErrForbidden
	}
	return pid, nil
}

// writeXIRR emits a consistent JSON response regardless of whether XIRR
// converged — the UI surfaces the "not enough history" case rather than
// treating it as a hard error.
func writeXIRR(w http.ResponseWriter, r *http.Request, res *Result, err error) {
	if errors.Is(err, ErrInsufficientFlows) {
		httpx.JSON(w, http.StatusOK, map[string]any{
			"rate":        nil,
			"flowCount":   res.FlowCount,
			"insufficient": true,
		})
		return
	}
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"rate":      res.Rate,
		"flowCount": res.FlowCount,
	})
}
