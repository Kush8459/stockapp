package user

import (
	"context"
	"errors"
	"net/http"
	"net/mail"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/stockapp/backend/internal/auth"
	"github.com/stockapp/backend/internal/httpx"
)

type Handler struct {
	repo       *Repo
	portfolios portfolioCreator
	wallets    walletSeeder
	signer     *auth.Signer
	authLimit  *httpx.RateLimiter
}

// portfolioCreator is the narrow dependency on the portfolio package needed
// to create a default portfolio at signup. Implemented by portfolio.Service.
type portfolioCreator interface {
	CreateDefault(ctx context.Context, userID uuid.UUID, name string) error
}

// walletSeeder seeds the starter balance on signup. Implemented by
// wallet.Service.EnsureForUser. Optional — nil is tolerated for tests.
type walletSeeder interface {
	EnsureForUser(ctx context.Context, userID uuid.UUID) error
}

// NewHandler builds the auth handler. authLimit, if non-nil, is applied to
// /auth/login and /auth/register to slow down credential-stuffing.
func NewHandler(db *pgxpool.Pool, signer *auth.Signer, portfolios portfolioCreator, wallets walletSeeder, authLimit *httpx.RateLimiter) *Handler {
	return &Handler{
		repo:       NewRepo(db),
		portfolios: portfolios,
		wallets:    wallets,
		signer:     signer,
		authLimit:  authLimit,
	}
}

func (h *Handler) Routes(r chi.Router) {
	r.Group(func(r chi.Router) {
		if h.authLimit != nil {
			r.Use(h.authLimit.Middleware)
		}
		r.Post("/auth/register", h.register)
		r.Post("/auth/login", h.login)
	})
	r.Post("/auth/refresh", h.refresh)
	r.Group(func(r chi.Router) {
		r.Use(auth.Middleware(h.signer))
		r.Get("/me", h.me)
	})
}

// --- DTOs ---

type registerReq struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName,omitempty"`
}

type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type refreshReq struct {
	RefreshToken string `json:"refreshToken"`
}

type tokenResp struct {
	AccessToken  string   `json:"accessToken"`
	RefreshToken string   `json:"refreshToken"`
	User         userView `json:"user"`
}

type userView struct {
	ID          string  `json:"id"`
	Email       string  `json:"email"`
	DisplayName *string `json:"displayName,omitempty"`
}

func toView(u *User) userView {
	return userView{ID: u.ID.String(), Email: u.Email, DisplayName: u.DisplayName}
}

// --- handlers ---

func (h *Handler) register(w http.ResponseWriter, r *http.Request) {
	var req registerReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if _, err := mail.ParseAddress(req.Email); err != nil {
		httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "invalid_email", "invalid email"))
		return
	}
	if len(req.Password) < 8 {
		httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "weak_password", "password must be at least 8 characters"))
		return
	}
	if len(req.Password) > 30 {
		httpx.Error(w, r, httpx.NewError(http.StatusBadRequest, "password_too_long", "password must be at most 30 characters"))
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}

	var displayName *string
	if s := strings.TrimSpace(req.DisplayName); s != "" {
		displayName = &s
	}

	u, err := h.repo.Create(r.Context(), req.Email, hash, displayName)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			httpx.Error(w, r, httpx.NewError(http.StatusConflict, "email_taken", "email already registered"))
			return
		}
		httpx.Error(w, r, err)
		return
	}

	// Best-effort default portfolio. Don't block signup if this fails.
	_ = h.portfolios.CreateDefault(r.Context(), u.ID, "My Portfolio")

	// Seed the starter wallet balance. Same best-effort posture — if this
	// fails the user's first wallet GET will create it lazily.
	if h.wallets != nil {
		_ = h.wallets.EnsureForUser(r.Context(), u.ID)
	}

	h.issueTokens(w, r, u, http.StatusCreated)
}

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	var req loginReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))

	u, err := h.repo.ByEmail(r.Context(), req.Email)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.Error(w, r, httpx.NewError(http.StatusUnauthorized, "invalid_credentials", "invalid email or password"))
			return
		}
		httpx.Error(w, r, err)
		return
	}
	if !auth.CheckPassword(u.PasswordHash, req.Password) {
		httpx.Error(w, r, httpx.NewError(http.StatusUnauthorized, "invalid_credentials", "invalid email or password"))
		return
	}

	h.issueTokens(w, r, u, http.StatusOK)
}

func (h *Handler) refresh(w http.ResponseWriter, r *http.Request) {
	var req refreshReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	claims, err := h.signer.Parse(req.RefreshToken, auth.RefreshToken)
	if err != nil {
		httpx.Error(w, r, httpx.ErrUnauthorized)
		return
	}
	u, err := h.repo.ByID(r.Context(), claims.UserID)
	if err != nil {
		httpx.Error(w, r, httpx.ErrUnauthorized)
		return
	}
	h.issueTokens(w, r, u, http.StatusOK)
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	id, err := auth.RequireUser(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	u, err := h.repo.ByID(r.Context(), id)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toView(u))
}

func (h *Handler) issueTokens(w http.ResponseWriter, r *http.Request, u *User, status int) {
	access, _, err := h.signer.Sign(u.ID, auth.AccessToken)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	refresh, _, err := h.signer.Sign(u.ID, auth.RefreshToken)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, status, tokenResp{
		AccessToken:  access,
		RefreshToken: refresh,
		User:         toView(u),
	})
}
