package tax

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/stockapp/backend/internal/auth"
	"github.com/stockapp/backend/internal/httpx"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Routes(r chi.Router) {
	r.Get("/tax/summary", h.summary)
}

func (h *Handler) summary(w http.ResponseWriter, r *http.Request) {
	userID, err := auth.RequireUser(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	report, err := h.svc.Report(r.Context(), userID)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, report)
}
