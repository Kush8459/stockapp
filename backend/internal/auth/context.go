package auth

import (
	"context"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/stockapp/backend/internal/httpx"
)

type ctxKey struct{}

// WithUser attaches a user id to the request context.
func WithUser(ctx context.Context, id uuid.UUID) context.Context {
	return context.WithValue(ctx, ctxKey{}, id)
}

// UserID returns the authenticated user id, if any.
func UserID(ctx context.Context) (uuid.UUID, bool) {
	v, ok := ctx.Value(ctxKey{}).(uuid.UUID)
	return v, ok
}

// Middleware rejects requests without a valid access token and injects the
// user id into the context.
func Middleware(signer *Signer) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := r.Header.Get("Authorization")
			if !strings.HasPrefix(h, "Bearer ") {
				httpx.Error(w, r, httpx.ErrUnauthorized)
				return
			}
			claims, err := signer.Parse(strings.TrimPrefix(h, "Bearer "), AccessToken)
			if err != nil {
				httpx.Error(w, r, httpx.ErrUnauthorized)
				return
			}
			ctx := WithUser(r.Context(), claims.UserID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireUser extracts the authenticated user id or returns 401.
func RequireUser(r *http.Request) (uuid.UUID, error) {
	id, ok := UserID(r.Context())
	if !ok {
		return uuid.Nil, httpx.ErrUnauthorized
	}
	return id, nil
}
