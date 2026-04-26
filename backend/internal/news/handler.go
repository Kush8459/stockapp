package news

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/stockapp/backend/internal/httpx"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Routes(r chi.Router) {
	r.Get("/news/{ticker}", h.forTicker)
}

func (h *Handler) forTicker(w http.ResponseWriter, r *http.Request) {
	ticker := strings.ToUpper(chi.URLParam(r, "ticker"))
	items, err := h.svc.ForTicker(r.Context(), ticker)
	if err != nil {
		switch {
		case errors.Is(err, ErrDisabled):
			httpx.Error(w, r, httpx.NewError(
				http.StatusServiceUnavailable,
				"news_disabled",
				"News feed is not configured on this server (NEWSAPI_KEY is missing).",
			))
		case errors.Is(err, ErrTransient):
			httpx.Error(w, r, httpx.NewError(
				http.StatusServiceUnavailable,
				"news_upstream",
				"News provider is temporarily unavailable. Try again shortly.",
			))
		default:
			httpx.Error(w, r, err)
		}
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"ticker": ticker,
		"items":  items,
	})
}
