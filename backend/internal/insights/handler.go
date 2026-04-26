package insights

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/stockapp/backend/internal/auth"
	"github.com/stockapp/backend/internal/httpx"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Routes(r chi.Router) {
	r.Get("/insights", h.get)
	r.Post("/insights/refresh", h.refresh)
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	h.emit(w, r, false)
}

func (h *Handler) refresh(w http.ResponseWriter, r *http.Request) {
	h.emit(w, r, true)
}

func (h *Handler) emit(w http.ResponseWriter, r *http.Request, forceFresh bool) {
	userID, err := auth.RequireUser(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	res, err := h.svc.Get(r.Context(), userID, forceFresh)
	if err != nil {
		switch {
		case errors.Is(err, ErrDisabled):
			httpx.Error(w, r, httpx.NewError(
				http.StatusServiceUnavailable,
				"insights_disabled",
				"AI insights are not configured on this server (GEMINI_API_KEY is missing).",
			))
		case errors.Is(err, ErrUpstream):
			httpx.Error(w, r, httpx.NewError(
				http.StatusBadGateway,
				"insights_upstream",
				"The AI provider is temporarily unavailable. Try again shortly.",
			))
		default:
			httpx.Error(w, r, err)
		}
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}
