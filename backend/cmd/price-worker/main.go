package main

import (
	"context"
	"errors"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"

	"github.com/stockapp/backend/internal/config"
	"github.com/stockapp/backend/internal/indices"
	"github.com/stockapp/backend/internal/logger"
	"github.com/stockapp/backend/internal/postgres"
	"github.com/stockapp/backend/internal/price"
	"github.com/stockapp/backend/internal/redisx"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		panic(err)
	}
	logger.Init(cfg.Env)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	rdb, err := redisx.New(ctx, cfg.Redis.Addr, cfg.Redis.Password, cfg.Redis.DB, cfg.Redis.TLS)
	if err != nil {
		log.Fatal().Err(err).Msg("redis connect")
	}
	defer rdb.Close()

	// Postgres connection — used by the upstox path's dynamic ticker
	// watcher. The other PRICE_SOURCEs don't need it but the connection is
	// cheap and keeps main() simple.
	db, err := postgres.New(ctx, cfg.Postgres.DSN())
	if err != nil {
		log.Fatal().Err(err).Msg("postgres connect")
	}
	defer db.Close()

	cache := price.NewCache(rdb)

	switch cfg.Price.Source {
	case "mock", "":
		log.Info().Msg("starting mock price feed")
		if err := price.RunMockFeed(ctx, cache, 2*time.Second); err != nil && !errors.Is(err, context.Canceled) {
			log.Fatal().Err(err).Msg("mock feed stopped")
		}

	case "real":
		runRealFeeds(ctx, cache, db)

	case "upstox":
		// Upstox covers NSE stocks; MFs still ride on mfapi.in. If the user
		// hasn't pasted an access token yet, fall back to Yahoo so the demo
		// keeps working end-to-end.
		if cfg.Upstox.AccessToken == "" {
			log.Warn().Msg("PRICE_SOURCE=upstox but UPSTOX_ACCESS_TOKEN is empty; falling back to 'real' (Yahoo+mfapi)")
			runRealFeeds(ctx, cache, db)
		} else {
			// Block startup on the two universe loaders so the WS dispatch
			// sees the full ~500-ticker NIFTY 500 set, not just the
			// hardcoded ~48 in MockUniverse. 30 s timeout means a network
			// failure won't hang the worker — it falls back to the
			// hardcoded set and keeps streaming.
			loadCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
			var loadWG sync.WaitGroup
			loadWG.Add(2)
			go func() {
				defer loadWG.Done()
				if err := price.LoadUpstoxInstruments(loadCtx); err != nil {
					log.Warn().Err(err).Msg("upstox instruments CSV failed; hardcoded map continues")
				}
			}()
			go func() {
				defer loadWG.Done()
				indices.LoadAll(loadCtx)
			}()
			loadWG.Wait()
			cancel()
			runUpstoxFeeds(ctx, cache, db, cfg.Upstox.AccessToken)
		}

	case "polygon":
		log.Warn().Msg("polygon source not implemented yet; running mock feed instead")
		if err := price.RunMockFeed(ctx, cache, 2*time.Second); err != nil && !errors.Is(err, context.Canceled) {
			log.Fatal().Err(err).Msg("mock feed stopped")
		}

	default:
		log.Fatal().Str("source", cfg.Price.Source).Msg("unknown PRICE_SOURCE (use mock | real | upstox | polygon)")
	}
	log.Info().Msg("price worker exiting")
}

// runRealFeeds dispatches the mock universe to its real provider:
// NSE stocks go to Yahoo Finance, mutual funds to mfapi.in. Each runs in
// its own goroutine so a slow provider doesn't block the other.
//
// MFs are discovered dynamically per tick: any MF ticker held by a user
// or referenced by an active SIP plan is polled, plus the legacy demo
// scheme tickers in price.MFSchemes. New MF buys join the live-NAV set
// within one mfapi poll interval (no worker restart).
func runRealFeeds(ctx context.Context, cache *price.Cache, db *pgxpool.Pool) {
	var nseTickers []string
	for ticker := range price.MockUniverse {
		if _, ok := price.MFSchemes[ticker]; ok {
			continue
		}
		if _, ok := price.NSESymbols[ticker]; ok {
			nseTickers = append(nseTickers, ticker)
			continue
		}
		log.Warn().Str("ticker", ticker).Msg("no real-feed provider for ticker, it will stay stale")
	}

	log.Info().
		Strs("nse", nseTickers).
		Msg("starting real price feeds (mf set discovered dynamically)")

	var wg sync.WaitGroup
	spawn := func(fn func() error, name string) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := fn(); err != nil && !errors.Is(err, context.Canceled) {
				log.Error().Err(err).Str("feed", name).Msg("feed stopped")
			}
		}()
	}
	if len(nseTickers) > 0 {
		spawn(func() error {
			return price.RunYahooFeed(ctx, cache, nseTickers, 30*time.Second)
		}, "yahoo")
	}
	spawn(func() error {
		return price.RunMFAPIFeed(ctx, cache, mfTickerDiscovery(ctx, db), 30*time.Minute)
	}, "mfapi")
	wg.Wait()
}

// mfTickerDiscovery returns a closure that, on every call, builds the
// current set of MF tickers worth polling: legacy demo schemes from
// price.MFSchemes ∪ any ticker stored in holdings (qty>0) or active
// sip_plans whose asset_type='mf'. The DB query is best-effort — if it
// fails, the legacy set still gets polled.
func mfTickerDiscovery(ctx context.Context, db *pgxpool.Pool) func() []string {
	return func() []string {
		seen := make(map[string]struct{}, 16)
		for t := range price.MFSchemes {
			seen[t] = struct{}{}
		}
		qctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		rows, err := db.Query(qctx, `
			SELECT DISTINCT ticker FROM holdings WHERE asset_type = 'mf' AND quantity > 0
			UNION
			SELECT DISTINCT ticker FROM sip_plans WHERE asset_type = 'mf' AND status = 'active'
		`)
		if err != nil {
			log.Warn().Err(err).Msg("mfapi: ticker discovery query failed")
		} else {
			defer rows.Close()
			for rows.Next() {
				var t string
				if err := rows.Scan(&t); err == nil && price.IsMFTicker(t) {
					seen[t] = struct{}{}
				}
			}
		}
		out := make([]string, 0, len(seen))
		for t := range seen {
			out = append(out, t)
		}
		return out
	}
}

// runUpstoxFeeds dispatches NSE stocks to the Upstox v3 WebSocket feed and
// MFs to mfapi.in (Upstox doesn't cover AMFI mutual funds).
//
// The Upstox set is dynamic: a closure passed into RunUpstoxWSFeed re-runs
// every minute, querying Postgres for every ticker held by any user (plus
// the hardcoded MockUniverse for indices and demo tickers). New buys
// automatically join the WS subscription within a minute, no restart.
func runUpstoxFeeds(ctx context.Context, cache *price.Cache, db *pgxpool.Pool, token string) {
	// Yahoo-fallback set: MockUniverse entries that aren't on Upstox and
	// aren't MFs (e.g., demo tickers Upstox can't resolve).
	var yahooFallback []string
	for ticker := range price.MockUniverse {
		if price.IsMFTicker(ticker) {
			continue
		}
		if _, ok := price.LookupUpstoxKey(ticker); !ok {
			yahooFallback = append(yahooFallback, ticker)
		}
	}

	// Dynamic Upstox set: MockUniverse stocks/indices + every NIFTY 500
	// constituent + every active holding/SIP ticker, deduplicated.
	addTicker := func(seen map[string]struct{}, t string) {
		if price.IsMFTicker(t) {
			return
		}
		if _, ok := price.LookupUpstoxKey(t); !ok {
			return
		}
		seen[t] = struct{}{}
	}
	upstoxTickersFn := func() []string {
		seen := make(map[string]struct{}, 600)
		for t := range price.MockUniverse {
			addTicker(seen, t)
		}
		// NSE index constituents (NIFTY 50/100/500/etc.). May be empty
		// during the first few seconds before indices.LoadAll completes.
		for _, t := range indices.AllTickers() {
			addTicker(seen, t)
		}
		// Best-effort DB query for user-added tickers (holdings, SIPs,
		// watchlist). Anything we can't reach falls back to the hardcoded
		// MockUniverse + index sets above.
		qctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		rows, err := db.Query(qctx, `
			SELECT DISTINCT ticker FROM holdings WHERE quantity > 0
			UNION
			SELECT DISTINCT ticker FROM sip_plans WHERE status = 'active'
			UNION
			SELECT DISTINCT ticker FROM watchlist
		`)
		if err != nil {
			log.Warn().Err(err).Msg("upstox: ticker discovery query failed")
		} else {
			defer rows.Close()
			for rows.Next() {
				var t string
				if err := rows.Scan(&t); err != nil {
					continue
				}
				addTicker(seen, t)
			}
		}
		out := make([]string, 0, len(seen))
		for t := range seen {
			out = append(out, t)
		}
		return out
	}

	log.Info().
		Strs("yahoo_fallback", yahooFallback).
		Msg("starting upstox (dynamic) + mfapi price feeds (mf set discovered dynamically)")

	var wg sync.WaitGroup
	spawn := func(fn func() error, name string) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := fn(); err != nil && !errors.Is(err, context.Canceled) {
				log.Error().Err(err).Str("feed", name).Msg("feed stopped")
			}
		}()
	}
	spawn(func() error {
		return price.RunUpstoxWSFeed(ctx, cache, token, upstoxTickersFn)
	}, "upstox-ws")
	if len(yahooFallback) > 0 {
		spawn(func() error {
			return price.RunYahooFeed(ctx, cache, yahooFallback, 30*time.Second)
		}, "yahoo")
	}
	spawn(func() error {
		return price.RunMFAPIFeed(ctx, cache, mfTickerDiscovery(ctx, db), 30*time.Minute)
	}, "mfapi")
	wg.Wait()
}
