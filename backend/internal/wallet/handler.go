package wallet

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/shopspring/decimal"

	"github.com/stockapp/backend/internal/auth"
	"github.com/stockapp/backend/internal/httpx"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Routes(r chi.Router) {
	r.Get("/wallet", h.get)
	r.Post("/wallet/deposit", h.deposit)
	r.Post("/wallet/withdraw", h.withdraw)
	r.Get("/wallet/transactions", h.history)
}

type movementReq struct {
	Amount    string `json:"amount"`
	Method    string `json:"method"`     // upi | bank | card
	Reference string `json:"reference"`  // user-facing label, optional
	Note      string `json:"note,omitempty"`
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	userID, err := auth.RequireUser(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	wallet, err := h.svc.Get(r.Context(), userID)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, wallet)
}

func (h *Handler) deposit(w http.ResponseWriter, r *http.Request) {
	h.movement(w, r, "deposit")
}

func (h *Handler) withdraw(w http.ResponseWriter, r *http.Request) {
	h.movement(w, r, "withdraw")
}

func (h *Handler) movement(w http.ResponseWriter, r *http.Request, kind string) {
	userID, err := auth.RequireUser(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	var req movementReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	amount, err := decimal.NewFromString(req.Amount)
	if err != nil || amount.Sign() <= 0 {
		httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_amount", "amount must be a positive decimal"))
		return
	}

	var mv *Movement
	switch kind {
	case "deposit":
		mv, err = h.svc.Deposit(r.Context(), userID, amount, req.Method, req.Reference, req.Note)
	case "withdraw":
		mv, err = h.svc.Withdraw(r.Context(), userID, amount, req.Method, req.Reference, req.Note)
	}
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidAmount):
			httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_amount", "amount must be positive"))
		case errors.Is(err, ErrUnsupportedMethod):
			httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_method", "method must be upi, bank, or card"))
		case errors.Is(err, ErrWithdrawTooLarge):
			httpx.Error(w, r, httpx.NewError(http.StatusUnprocessableEntity, "insufficient_balance", "withdraw amount exceeds wallet balance"))
		default:
			httpx.Error(w, r, err)
		}
		return
	}

	// Return the movement + the latest balance so the client can update its
	// cached wallet without a follow-up GET.
	httpx.JSON(w, http.StatusCreated, map[string]any{
		"movement":     mv,
		"balanceAfter": mv.BalanceAfter,
	})
}

func (h *Handler) history(w http.ResponseWriter, r *http.Request) {
	userID, err := auth.RequireUser(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	items, err := h.svc.History(r.Context(), userID, limit)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}
