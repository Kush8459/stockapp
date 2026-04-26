package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// TokenKind distinguishes access vs refresh tokens so they can't be swapped.
type TokenKind string

const (
	AccessToken  TokenKind = "access"
	RefreshToken TokenKind = "refresh"
)

type Claims struct {
	UserID uuid.UUID `json:"uid"`
	Kind   TokenKind `json:"kind"`
	jwt.RegisteredClaims
}

type Signer struct {
	secret     []byte
	accessTTL  time.Duration
	refreshTTL time.Duration
}

func NewSigner(secret string, accessTTL, refreshTTL time.Duration) *Signer {
	return &Signer{secret: []byte(secret), accessTTL: accessTTL, refreshTTL: refreshTTL}
}

func (s *Signer) Sign(userID uuid.UUID, kind TokenKind) (string, time.Time, error) {
	ttl := s.accessTTL
	if kind == RefreshToken {
		ttl = s.refreshTTL
	}
	exp := time.Now().Add(ttl)
	claims := Claims{
		UserID: userID,
		Kind:   kind,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID.String(),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(exp),
			ID:        uuid.NewString(),
			Issuer:    "stockapp",
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := tok.SignedString(s.secret)
	if err != nil {
		return "", time.Time{}, err
	}
	return signed, exp, nil
}

func (s *Signer) Parse(raw string, expect TokenKind) (*Claims, error) {
	tok, err := jwt.ParseWithClaims(raw, &Claims{}, func(t *jwt.Token) (any, error) {
		if t.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, fmt.Errorf("unexpected alg %s", t.Method.Alg())
		}
		return s.secret, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := tok.Claims.(*Claims)
	if !ok || !tok.Valid {
		return nil, errors.New("invalid token")
	}
	if claims.Kind != expect {
		return nil, fmt.Errorf("expected %s token, got %s", expect, claims.Kind)
	}
	return claims, nil
}
