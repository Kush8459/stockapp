package transaction

import (
	"errors"
	"net"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/stockapp/backend/internal/auth"
	"github.com/stockapp/backend/internal/httpx"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Routes(r chi.Router) {
	r.Post("/transactions", h.create)
	r.Get("/transactions", h.list)
	r.Get("/transactions/{id}", h.detail)
}

type createReq struct {
	PortfolioID string `json:"portfolioId"`
	Ticker      string `json:"ticker"`
	AssetType   string `json:"assetType"`
	Side        string `json:"side"`
	Quantity    string `json:"quantity"`
	Price       string `json:"price"`
	Fees        string `json:"fees,omitempty"`
	Note        string `json:"note,omitempty"`
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
	qty, err := decimal.NewFromString(req.Quantity)
	if err != nil {
		httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_qty", "invalid quantity"))
		return
	}
	price, err := decimal.NewFromString(req.Price)
	if err != nil {
		httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_price", "invalid price"))
		return
	}
	fees := decimal.Zero
	if req.Fees != "" {
		fees, err = decimal.NewFromString(req.Fees)
		if err != nil {
			httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_fees", "invalid fees"))
			return
		}
	}
	side := Side(strings.ToLower(req.Side))
	if side != SideBuy && side != SideSell {
		httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "bad_side", "side must be buy or sell"))
		return
	}
	assetType := strings.ToLower(req.AssetType)
	if assetType == "" {
		assetType = "stock"
	}

	var note *string
	if s := strings.TrimSpace(req.Note); s != "" {
		note = &s
	}

	txn, err := h.svc.Execute(r.Context(), ExecuteInput{
		UserID:      userID,
		PortfolioID: pid,
		Ticker:      strings.ToUpper(strings.TrimSpace(req.Ticker)),
		AssetType:   assetType,
		Side:        side,
		Quantity:    qty,
		Price:       price,
		Fees:        fees,
		Note:        note,
		IP:          clientIP(r),
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrNotAllowed):
			httpx.Error(w, r, httpx.ErrForbidden)
		case errors.Is(err, ErrHoldingNotFound):
			httpx.Error(w, r, httpx.NewError(http.StatusUnprocessableEntity, "no_position", "no open position to sell"))
		case errors.Is(err, ErrInsufficientQty):
			httpx.Error(w, r, httpx.NewError(http.StatusUnprocessableEntity, "insufficient_quantity", "cannot sell more than you own"))
		default:
			httpx.Error(w, r, err)
		}
		return
	}
	httpx.JSON(w, http.StatusCreated, txn)
}

func (h *Handler) detail(w http.ResponseWriter, r *http.Request) {
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
	d, err := h.svc.Detail(r.Context(), userID, id)
	if err != nil {
		if errors.Is(err, ErrNotAllowed) {
			httpx.Error(w, r, httpx.ErrNotFound)
			return
		}
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, d)
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
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
	items, err := h.svc.ListForUser(r.Context(), userID, limit)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

// clientIP returns the caller's bare IP (no port). audit_log.ip is a Postgres
// INET, which rejects IP:PORT strings, so we always split before returning.
// Returns "" if no valid IP can be extracted — the caller treats that as NULL.
func clientIP(r *http.Request) string {
	raw := r.RemoteAddr
	if f := r.Header.Get("X-Forwarded-For"); f != "" {
		if comma := strings.IndexByte(f, ','); comma >= 0 {
			raw = strings.TrimSpace(f[:comma])
		} else {
			raw = strings.TrimSpace(f)
		}
	}
	if raw == "" {
		return ""
	}
	// net.SplitHostPort handles both "1.2.3.4:5678" and "[::1]:5678".
	if host, _, err := net.SplitHostPort(raw); err == nil {
		raw = host
	}
	if net.ParseIP(raw) == nil {
		return ""
	}
	return raw
}
