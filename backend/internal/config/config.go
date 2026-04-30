package config

import (
	"fmt"
	"strings"
	"time"

	"github.com/spf13/viper"
)

type Config struct {
	Env         string
	HTTPAddr    string
	CORSOrigins []string

	Postgres Postgres
	Redis    Redis
	JWT      JWT
	Price    Price
	News     News
	Upstox   Upstox
}

type Postgres struct {
	User     string
	Password string
	Host     string
	Port     int
	DB       string
	SSLMode  string
}

func (p Postgres) DSN() string {
	return fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=%s",
		p.User, p.Password, p.Host, p.Port, p.DB, p.SSLMode,
	)
}

type Redis struct {
	Addr     string
	Password string
	DB       int
	TLS      bool
}

type JWT struct {
	Secret     string
	AccessTTL  time.Duration
	RefreshTTL time.Duration
}

type Price struct {
	Source        string // "mock" | "real" | "upstox" | "polygon"
	PolygonAPIKey string
}

// Upstox holds the API key + per-day access token for the Upstox v2 market
// data feed. APIKey/APISecret/RedirectURL are used by `cmd/upstox-login` to
// run the OAuth dance; AccessToken is the daily refreshed bearer token the
// price worker uses for live quotes. Empty AccessToken disables the feed
// (the worker falls back to whichever PRICE_SOURCE is set).
//
// Tokens expire ~3:30 AM IST every day — the user re-runs upstox-login and
// pastes the new token into .env.
type Upstox struct {
	APIKey      string
	APISecret   string
	RedirectURL string
	AccessToken string
}

// News carries third-party news-feed config. An empty APIKey disables the
// news endpoint at runtime (handler returns 503 with a friendly message).
type News struct {
	APIKey string
}

// Load reads configuration from environment variables. It also reads a .env
// file if one exists in the working directory or one level up.
func Load() (*Config, error) {
	v := viper.New()

	v.SetDefault("APP_ENV", "development")
	v.SetDefault("APP_HTTP_ADDR", ":8080")
	v.SetDefault("APP_CORS_ORIGINS", "http://localhost:5173")

	v.SetDefault("POSTGRES_USER", "stockapp")
	v.SetDefault("POSTGRES_PASSWORD", "stockapp")
	v.SetDefault("POSTGRES_HOST", "localhost")
	v.SetDefault("POSTGRES_PORT", 5432)
	v.SetDefault("POSTGRES_DB", "stockapp")
	v.SetDefault("POSTGRES_SSLMODE", "disable")

	v.SetDefault("REDIS_ADDR", "localhost:6379")
	v.SetDefault("REDIS_PASSWORD", "")
	v.SetDefault("REDIS_DB", 0)
	v.SetDefault("REDIS_TLS", false)

	v.SetDefault("JWT_ACCESS_TTL", "15m")
	v.SetDefault("JWT_REFRESH_TTL", "720h")

	v.SetDefault("PRICE_SOURCE", "mock")

	v.SetDefault("UPSTOX_REDIRECT_URL", "http://localhost:8080/api/v1/integrations/upstox/callback")

	v.AutomaticEnv()

	// Try a .env in the cwd first, then the repo root (one level up).
	for _, path := range []string{".", ".."} {
		v.SetConfigFile(path + "/.env")
		v.SetConfigType("env")
		if err := v.MergeInConfig(); err == nil {
			break
		}
	}

	accessTTL, err := time.ParseDuration(v.GetString("JWT_ACCESS_TTL"))
	if err != nil {
		return nil, fmt.Errorf("JWT_ACCESS_TTL: %w", err)
	}
	refreshTTL, err := time.ParseDuration(v.GetString("JWT_REFRESH_TTL"))
	if err != nil {
		return nil, fmt.Errorf("JWT_REFRESH_TTL: %w", err)
	}

	cfg := &Config{
		Env:         v.GetString("APP_ENV"),
		HTTPAddr:    v.GetString("APP_HTTP_ADDR"),
		CORSOrigins: splitCSV(v.GetString("APP_CORS_ORIGINS")),
		Postgres: Postgres{
			User:     v.GetString("POSTGRES_USER"),
			Password: v.GetString("POSTGRES_PASSWORD"),
			Host:     v.GetString("POSTGRES_HOST"),
			Port:     v.GetInt("POSTGRES_PORT"),
			DB:       v.GetString("POSTGRES_DB"),
			SSLMode:  v.GetString("POSTGRES_SSLMODE"),
		},
		Redis: Redis{
			Addr:     v.GetString("REDIS_ADDR"),
			Password: v.GetString("REDIS_PASSWORD"),
			DB:       v.GetInt("REDIS_DB"),
			TLS:      v.GetBool("REDIS_TLS"),
		},
		JWT: JWT{
			Secret:     v.GetString("JWT_SECRET"),
			AccessTTL:  accessTTL,
			RefreshTTL: refreshTTL,
		},
		Price: Price{
			Source:        v.GetString("PRICE_SOURCE"),
			PolygonAPIKey: v.GetString("POLYGON_API_KEY"),
		},
		News: News{
			APIKey: v.GetString("NEWSAPI_KEY"),
		},
		Upstox: Upstox{
			APIKey:      v.GetString("UPSTOX_API_KEY"),
			APISecret:   v.GetString("UPSTOX_API_SECRET"),
			RedirectURL: v.GetString("UPSTOX_REDIRECT_URL"),
			AccessToken: v.GetString("UPSTOX_ACCESS_TOKEN"),
		},
	}

	if cfg.JWT.Secret == "" {
		return nil, fmt.Errorf("JWT_SECRET is required")
	}
	if len(cfg.JWT.Secret) < 32 {
		return nil, fmt.Errorf("JWT_SECRET must be at least 32 chars")
	}

	return cfg, nil
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}
