package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/stockapp/backend/internal/alert"
	"github.com/stockapp/backend/internal/auth"
	"github.com/stockapp/backend/internal/config"
	"github.com/stockapp/backend/internal/dividend"
	"github.com/stockapp/backend/internal/fundamentals"
	"github.com/stockapp/backend/internal/httpx"
	"github.com/stockapp/backend/internal/indices"
	"github.com/stockapp/backend/internal/insights"
	"github.com/stockapp/backend/internal/logger"
	"github.com/stockapp/backend/internal/market"
	"github.com/stockapp/backend/internal/mf"
	"github.com/stockapp/backend/internal/news"
	"github.com/stockapp/backend/internal/pnl"
	"github.com/stockapp/backend/internal/portfolio"
	"github.com/stockapp/backend/internal/postgres"
	"github.com/stockapp/backend/internal/price"
	"github.com/stockapp/backend/internal/redisx"
	"github.com/stockapp/backend/internal/sectors"
	"github.com/stockapp/backend/internal/sip"
	"github.com/stockapp/backend/internal/stocks"
	"github.com/stockapp/backend/internal/tax"
	"github.com/stockapp/backend/internal/transaction"
	"github.com/stockapp/backend/internal/user"
	"github.com/stockapp/backend/internal/watchlist"
)

func main() {
	if err := run(); err != nil {
		log.Fatal().Err(err).Msg("server exited")
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	logger.Init(cfg.Env)
	log.Info().Str("env", cfg.Env).Msg("starting stockapp api")

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	db, err := postgres.New(ctx, cfg.Postgres.DSN())
	if err != nil {
		return err
	}
	defer db.Close()
	log.Info().Str("host", cfg.Postgres.Host).Msg("postgres connected")

	rdb, err := redisx.New(ctx, cfg.Redis.Addr, cfg.Redis.Password, cfg.Redis.DB)
	if err != nil {
		return err
	}
	defer rdb.Close()
	log.Info().Str("addr", cfg.Redis.Addr).Msg("redis connected")

	signer := auth.NewSigner(cfg.JWT.Secret, cfg.JWT.AccessTTL, cfg.JWT.RefreshTTL)

	priceCache := price.NewCache(rdb)
	priceHub := price.NewHub(priceCache)
	go func() {
		if err := priceHub.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Error().Err(err).Msg("price hub stopped")
		}
	}()

	// Background-load the Upstox instruments CSV so /api/v1/search can serve
	// from a local index instead of hitting Yahoo. The price-worker loads
	// its own copy independently — these two processes don't share memory.
	go func() {
		if err := price.LoadUpstoxInstruments(ctx); err != nil {
			log.Warn().Err(err).Msg("upstox instruments CSV failed; search will fall back to Yahoo")
		}
	}()

	// Mutual-fund catalog: fetch the full mfapi directory, parse + bucket
	// by category, refresh daily. Failure here is non-fatal — /mf/catalog
	// will simply return an empty list until a successful refresh.
	mfSvc := mf.NewService(rdb)
	go func() {
		if err := mfSvc.Start(ctx); err != nil {
			log.Warn().Err(err).Msg("mf catalog failed to start; /mf/catalog will be empty")
		}
	}()
	// Background-load NSE index constituents so /market/movers?index=…
	// can filter rankings by membership.
	go indices.LoadAll(ctx)

	portSvc := portfolio.NewService(db, priceCache)
	txnSvc := transaction.NewService(db)
	pnlSvc := pnl.NewService(db, priceCache)
	alertRepo := alert.NewRepo(db)
	alertEngine := alert.NewEngine(db, priceCache, priceHub)
	go func() {
		if err := alertEngine.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Error().Err(err).Msg("alert engine stopped")
		}
	}()

	newsSvc := news.NewService(cfg.News.APIKey, rdb)
	if !newsSvc.Enabled() {
		log.Warn().Msg("NEWSAPI_KEY not set — /news/:ticker will return 503")
	}

	insightsSvc := insights.NewService(
		cfg.Gemini.APIKey, cfg.Gemini.Model, cfg.Gemini.FallbackModel,
		db, rdb, portSvc, pnlSvc,
	)
	if !insightsSvc.Enabled() {
		log.Warn().Msg("GEMINI_API_KEY not set — /insights will return 503")
	}

	sipRepo := sip.NewRepo(db)
	sipScheduler := sip.NewScheduler(sipRepo, priceCache, txnSvc)
	go func() {
		if err := sipScheduler.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Error().Err(err).Msg("sip scheduler stopped")
		}
	}()

	// --- router ---
	r := chi.NewRouter()
	r.Use(httpx.RequestID)
	r.Use(httpx.Recoverer)
	r.Use(httpx.Logger)
	r.Use(httpx.SecurityHeaders(cfg.Env == "production"))
	r.Use(httpx.CORS(cfg.CORSOrigins))

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]any{"status": "ok", "time": time.Now().UTC()})
	})

	// 5 req burst, 1 token / 12s ≈ 5 per minute per IP. Enough for honest
	// retries; tight enough to make credential stuffing painful.
	authLimiter := httpx.NewRateLimiter(5, 12*time.Second)

	r.Route("/api/v1", func(r chi.Router) {
		user.NewHandler(db, signer, portSvc, authLimiter).Routes(r)

		// public price endpoints (the UI reads these before auth completes)
		price.NewHandler(priceCache, rdb).Routes(r)
		market.NewHandler(priceCache).Routes(r)
		sectors.NewHandler(priceCache).Routes(r)
		fundamentals.NewHandler(fundamentals.NewService(rdb)).Routes(r)
		mf.NewHandler(mfSvc, priceCache, rdb).Routes(r)
		stocks.NewHandler(priceCache, rdb).Routes(r)

		r.Group(func(r chi.Router) {
			r.Use(auth.Middleware(signer))
			portfolio.NewHandler(portSvc).Routes(r)
			transaction.NewHandler(txnSvc).Routes(r)
			pnl.NewHandler(db, pnlSvc).Routes(r)
			alert.NewHandler(alertRepo).Routes(r)
			sip.NewHandler(sipRepo).Routes(r)
			news.NewHandler(newsSvc).Routes(r)
			insights.NewHandler(insightsSvc).Routes(r)
			tax.NewHandler(tax.NewService(db, priceCache)).Routes(r)
			// Multi-watchlist: /watchlists CRUD + /watchlists/:id/items.
			watchlist.NewHandler(watchlist.NewRepo(db), priceCache).Routes(r)
			dividend.NewHandler(dividend.NewRepo(db)).Routes(r)
		})
	})

	// WS uses its own auth (query-string JWT).
	r.Get("/ws", priceHub.Handler(signer))

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	serveErr := make(chan error, 1)
	go func() {
		log.Info().Str("addr", cfg.HTTPAddr).Msg("listening")
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
		}
	}()

	select {
	case <-ctx.Done():
		log.Info().Msg("shutdown requested")
	case err := <-serveErr:
		return err
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()
	return srv.Shutdown(shutdownCtx)
}
