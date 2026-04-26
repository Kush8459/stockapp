# Stockapp — Investment Tracking Platform

A production-style Indian-market investment tracker with live prices,
double-entry transaction ledger, XIRR, SIP scheduling, multi-watchlists,
dividend tracking, fundamentals + financials, sectoral heatmap, price
alerts, tax P&L, AI portfolio review, and a real-time React dashboard.

Built as a **Go backend + React frontend** with a modular-monolith
architecture that preserves clean service seams for future extraction.

> See [`docs/roadmap.md`](docs/roadmap.md) for the original product spec and
> [`docs/architecture.md`](docs/architecture.md) for the design decisions.

**Live demo:** _coming soon_ — see [`docs/deployment.md`](docs/deployment.md).

---

## Screenshots

> Captures pending — replace these placeholders with real PNGs in
> `docs/screenshots/` before publishing.

| | |
|---|---|
| ![Dashboard](docs/screenshots/dashboard.png) **Dashboard** — summary cards, day change, sector heatmap, top movers | ![Holdings](docs/screenshots/holdings.png) **Holdings** — per-ticker XIRR, allocation donut |
| ![Stock detail](docs/screenshots/stock-detail.png) **Stock detail** — fundamentals, financials, candles | ![Watchlist](docs/screenshots/watchlist.png) **Watchlist** — multi-list, live ticks |
| ![Tax](docs/screenshots/tax.png) **Tax** — LTCG / STCG by FY, CSV export | ![AI review](docs/screenshots/insights.png) **AI review** — Gemini-generated portfolio analysis |

---

## Highlights

- **Real-time prices** — Upstox **v3 WebSocket** feed (single global token,
  daily refresh) with snapshot-on-connect replay; Yahoo + mfapi.in fallback
  for tickers not on Upstox; mock generator for offline dev
- **Indian-market focused** — NSE/BSE equities + AMFI mutual funds (₹, FY,
  STCG/LTCG); no crypto, no US stocks
- **Dynamic ticker universe** — Upstox instruments CSV (~9 000 NSE equities)
  loaded at startup; per-user subscribe re-runs every 60 s so new buys
  join the live stream within a minute
- **Indices coverage** — NIFTY 50 / Next 50 / 100 / Midcap 100 / 500 +
  BankNifty + 11 sectoral indices, scraped from NSE archives
- **Market context bar** — live NIFTY 50 / SENSEX / BankNifty / NIFTY IT
  ticker plus market-open/closed badge from the NSE 2026 holiday calendar
- **Sectoral heatmap** — right sidebar with 11 sectoral indices; click any
  sector to drill into its constituent stocks
- **Top movers** — gainers / losers across the live cache, filterable by
  NIFTY 50 / 100 / Midcap 100 / 500 membership
- **Multi-watchlists** — N named lists per user; each ticker can live on
  any subset of them; star button on stock-detail toggles membership
- **Dividend tracking** — per-receipt log with TDS, FY/YTD totals,
  Yahoo-sourced auto-suggest of past dividends decorated with
  shares-on-ex-date and "already logged" detection
- **Fundamentals + financials** — Yahoo `quoteSummary` with 11 modules:
  valuation, profitability, calendar events, income statement, balance
  sheet, cash flow (yearly + quarterly). Interactive multi-metric chart
  with chip selectors and Indian-format axis labels (₹L / ₹Cr / ₹LCr)
- **Double-entry ledger** — every transaction writes matched `debit` /
  `credit` rows; the UI verifies the books balance
- **Append-only audit log** — Postgres triggers block `UPDATE` / `DELETE`
- **Buy/Sell with `SELECT FOR UPDATE`** — race-safe position management
- **XIRR** — Newton–Raphson with bisection fallback; per-portfolio + per-holding
- **SIP scheduler** — cron goroutine with `FOR UPDATE SKIP LOCKED` claim
- **Price alerts** — trigger engine consumes the price stream; user-scoped
  WebSocket fan-out so only you see your alerts
- **Tax P&L report** — FIFO lot matching, STCG / LTCG per Indian FY
- **AI review** — Gemini-powered portfolio analysis with structured output
  (sub-scores, highlights, strengths, risks, suggestions, next steps)
- **News feed** — per-ticker headlines with keyword-based sentiment
- **Global ticker search** — Upstox local index first (9 k tickers in
  RAM); Yahoo fallback for anything missing
- **Historical charts** — 1D / 1W / 1M / 3M / 1Y / 5Y / ALL ranges
- **CSV export** — portfolio statement, transactions, tax report

## Stack

| Layer | Tech |
|---|---|
| Backend | Go 1.25 · chi · pgx · redis · gorilla/websocket · JWT · zerolog · Viper · Upstox v3 WebSocket |
| Frontend | React 18 · TypeScript · Vite · Tailwind · Radix primitives · TanStack Query + Table · Recharts · Lightweight Charts · Framer Motion |
| Infra | PostgreSQL 15 · Redis 7 · Docker Compose |
| CI / CD | GitHub Actions · multi-stage Dockerfiles · distroless runtime |

## Quick start (local dev)

```bash
# 1. Copy env
cp .env.example .env
# Fill in JWT_SECRET (openssl rand -hex 32) and any optional API keys

# 2. Start infra
make dev-up           # or: docker compose up -d postgres redis

# 3. Apply migrations
make migrate-up       # or: docker compose --profile tools run --rm migrate up

# 4. Seed a demo user + holdings (optional)
cd backend && go run ./cmd/seed && cd ..
# Login: demo@stockapp.dev / demo1234

# 5. Run the API
make be-run           # or: cd backend && go run ./cmd/server

# 6. Run the price worker (separate terminal)
make be-worker        # or: cd backend && go run ./cmd/price-worker

# 7. Run the frontend (separate terminal)
make fe-install
make fe-dev           # http://localhost:5173
```

### Running with the live Upstox feed

Set `PRICE_SOURCE=upstox` in `.env`, then refresh the daily access token
(it expires at ~3:30 AM IST):

```bash
# stop the API first — the helper listens on the redirect port (8080)
cd backend && go run ./cmd/upstox-login
# paste the printed UPSTOX_ACCESS_TOKEN=… line into .env
# restart API + worker
```

The worker blocks startup briefly while it loads the Upstox instruments
CSV (~9 000 NSE equities) and the NSE index constituents, then opens the
v3 WebSocket and subscribes to MockUniverse + every NIFTY 500 ticker +
every active holding/SIP/watchlist ticker.

## Production deploy

Multi-stage Dockerfiles + prod compose are ready to go:

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml --profile tools run --rm migrate up
```

Full deployment guide with Railway, Fly.io, and VPS walk-throughs:
[`docs/deployment.md`](docs/deployment.md).

## Documentation

| Guide | What's in it |
|---|---|
| [`docs/features.md`](docs/features.md) | Every shipped feature and how it works |
| [`docs/api.md`](docs/api.md) | REST + WebSocket reference |
| [`docs/development.md`](docs/development.md) | Local setup, package map, common tasks |
| [`docs/deployment.md`](docs/deployment.md) | Hosting on Railway / Fly / VPS / cloud |
| [`docs/architecture.md`](docs/architecture.md) | Design decisions, extraction path |
| [`docs/troubleshooting.md`](docs/troubleshooting.md) | Common issues + fixes |
| [`docs/roadmap.md`](docs/roadmap.md) | Original product roadmap |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | PR workflow, code style |

## Layout

```
.
├── backend/
│   ├── cmd/
│   │   ├── server/           # HTTP API (main process)
│   │   ├── price-worker/     # price ingestion (mock | real | upstox)
│   │   ├── upstox-login/     # one-shot OAuth helper, prints daily token
│   │   └── seed/             # one-off demo data seeder
│   ├── internal/
│   │   ├── auth/             # JWT + bcrypt + middleware
│   │   ├── config/           # Viper loader
│   │   ├── httpx/            # router, middleware, errors
│   │   ├── logger/           # zerolog setup
│   │   ├── postgres/ redisx/ # connection pools
│   │   ├── user/             # register/login/refresh
│   │   ├── portfolio/        # portfolios + holdings + summary
│   │   ├── transaction/      # buy/sell + double-entry ledger + audit
│   │   ├── price/            # Redis cache, mock + Yahoo + Upstox v3 WS + mfapi feeds, WS hub, candles, search, instruments CSV
│   │   ├── pnl/              # XIRR + service
│   │   ├── alert/            # price alerts + trigger engine
│   │   ├── sip/              # SIP plans + scheduler goroutine
│   │   ├── watchlist/        # multi-list watchlists + items
│   │   ├── dividend/         # dividend log + Yahoo-sourced auto-suggest
│   │   ├── fundamentals/     # Yahoo quoteSummary (valuation + financials + balance sheet + cash flow)
│   │   ├── indices/          # NIFTY constituents from NSE archives
│   │   ├── market/           # NSE trading hours + holiday calendar + movers
│   │   ├── sectors/          # 11 sectoral indices + components for the heatmap
│   │   ├── news/             # NewsAPI integration with Redis cache
│   │   ├── insights/         # Gemini-powered AI review
│   │   └── tax/              # FIFO tax-lot matching + STCG/LTCG (Indian post-Jul-2024 rates)
│   ├── migrations/           # golang-migrate SQL files
│   ├── Dockerfile            # multi-stage → distroless
│   └── go.mod
├── frontend/
│   ├── src/
│   │   ├── pages/            # Dashboard, Holdings, Watchlist, StockDetail, SectorDetail, Transactions*, Alerts, Sips, Tax, Login, Register
│   │   ├── components/       # AppShell, MarketContextBar, MarketStatusBar, SectorSidebar, MarketMovers, FundamentalsCard, FinancialsCard, EventsCard, DividendsCard, WatchlistPopover, HoldingsTable, TradeDialog, AlertForm, AiInsights, NewsFeed, …
│   │   ├── hooks/            # TanStack Query hooks + useLivePrices (100 ms coalesce) + useDebounce
│   │   ├── store/            # Zustand (auth, alertEvents)
│   │   └── lib/              # api client, utils, csv
│   ├── Dockerfile            # multi-stage → nginx
│   └── nginx.conf
├── docs/                     # every guide listed above
├── .github/workflows/ci.yml  # lint + test + image build
├── docker-compose.yml        # dev infra (postgres + redis)
├── docker-compose.prod.yml   # full stack prod
├── Makefile
└── README.md
```

## Demo credentials

After `cd backend && go run ./cmd/seed`:

```
email:    demo@stockapp.dev
password: demo1234
```

Seeds a portfolio with real Indian equities (RELIANCE, TCS, INFY, HDFCBANK,
ICICIBANK, SBIN, WIPRO) and mutual funds (AXISBLUE, PPFAS), each with a
backdated buy transaction so XIRR and the tax report have history to work
with.

## License

MIT — see [`LICENSE`](LICENSE).
