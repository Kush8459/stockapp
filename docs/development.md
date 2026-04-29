# Development guide

Everything you need to run the stack locally, add features, and debug.

> For architecture rationale, see [`architecture.md`](architecture.md).
> For deployment, see [`deployment.md`](deployment.md).
> For API shapes, see [`api.md`](api.md).

---

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Go | 1.25+ | `go.mod` `go` directive — don't downgrade |
| Node | 20+ (22 tested) | Vite + React |
| Docker Desktop | Any recent | Postgres + Redis + optional containerized API |
| Make | any | Optional shortcut runner — all commands have `docker compose` equivalents |

Windows users: everything works on PowerShell. The Makefile assumes
bash but you can read it as a command list.

---

## First-time setup

```bash
# 1. Copy env and generate a JWT secret
cp .env.example .env
# edit .env: set JWT_SECRET=$(openssl rand -hex 32)
# leave NEWSAPI_KEY / UPSTOX_* commented out unless you have them

# 2. Start infra (postgres + redis in Docker)
docker compose up -d postgres redis

# 3. Apply schema
docker compose --profile tools run --rm migrate up

# 4. Seed a demo account with backdated transactions
cd backend && go run ./cmd/seed && cd ..
```

Three things to verify:

- `docker compose ps` shows both containers healthy
- `docker compose exec postgres psql -U stockapp -d stockapp -c "\dt"` lists every table including `watchlists`, `watchlist`, `dividends`
- `backend/cmd/seed` prints `user: … portfolio: … inserted 9 holdings`

---

## Running the app

Four terminals on the dev flow:

```bash
# Terminal 1 — API
cd backend && go run ./cmd/server

# Terminal 2 — price worker
cd backend && go run ./cmd/price-worker

# Terminal 3 — frontend
cd frontend && npm install && npm run dev    # http://localhost:5173

# (optional) Terminal 4 — migrations if you change the schema
docker compose --profile tools run --rm migrate up
```

**Windows shortcut:** run each `go run` command in its own PowerShell window.
The Makefile targets work on Git Bash / WSL.

### Switching to the live Upstox feed

```bash
# .env
PRICE_SOURCE=upstox
UPSTOX_API_KEY=…
UPSTOX_API_SECRET=…
UPSTOX_ACCESS_TOKEN=          # left empty initially

# Run the OAuth helper — opens a browser, listens on the redirect port
# (port 8080, so STOP THE API SERVER FIRST)
cd backend && go run ./cmd/upstox-login

# It prints   UPSTOX_ACCESS_TOKEN=<long-jwt>
# Paste that into .env and restart the API + worker
```

Tokens expire daily at ~3:30 AM IST. The worker logs `upstox: 401 — token
expired?` when this happens; just re-run the helper.

---

## Repo layout

```
backend/
├── cmd/                   Executables (one subdir = one binary)
│   ├── server/            HTTP API + WebSocket hub + SIP scheduler goroutine + alert engine
│   ├── price-worker/      Stand-alone price ingestion (mock | real | upstox)
│   ├── upstox-login/      One-shot OAuth helper, prints daily token
│   └── seed/              One-off demo data writer
├── internal/              Business code. `internal/` means "not importable by anyone else"
│   ├── auth/              JWT, bcrypt, chi middleware
│   ├── config/            Viper — only touch this when you add an env var
│   ├── httpx/             Router-layer helpers: errors, middleware, Decode, JSON
│   ├── logger/            zerolog config
│   ├── postgres/          pgx pool
│   ├── redisx/            redis client
│   ├── user/              Register / login / refresh / me
│   ├── portfolio/         Holdings, live-enriched views, summary
│   ├── transaction/       The big one: buy/sell + double-entry + audit in one SERIALIZABLE tx
│   ├── price/             Redis cache, feeds (mock | yahoo | mfapi | upstox v3 WS),
│   │                      WS hub, candles, search, instruments CSV, indices snapshot
│   ├── pnl/               XIRR + portfolio/holding rates
│   ├── alert/             Price alerts + trigger engine
│   ├── sip/               SIP plans + scheduler goroutine
│   ├── watchlist/         Multi-list watchlists + items + memberships
│   ├── dividend/          Dividend log + Yahoo-sourced auto-suggest
│   ├── fundamentals/      Yahoo quoteSummary + crumb-based session manager
│   ├── indices/           NSE archive CSV loader for NIFTY broad + sectoral indices
│   ├── market/            NSE trading hours + 2026 holiday calendar + movers handler
│   ├── sectors/           Hardcoded 11-sector heatmap (right sidebar, back-compat)
│   ├── stocks/            /stocks browse — categories + paginated catalog over indices
│   ├── mf/                /funds browse — AMFI directory loader + returns + metrics
│   ├── news/              NewsAPI + keyword sentiment
│   ├── wallet/            Cash account + charges (brokerage + statutory + GST) + atomic ApplyTradeInTx + deposit/withdraw
│   ├── goal/              Savings goals (target corpus + deadline) — CRUD only, on-track verdict is UI-side
│   ├── metrics/           Prometheus metric registry + HTTP middleware
│   └── tax/               FIFO lot matching + per-FY tax buckets (Indian post-Jul-2024)
├── migrations/            golang-migrate SQL files (numbered)
└── go.mod

frontend/
├── src/
│   ├── pages/             One file per route — Dashboard, Holdings, Watchlist,
│   │                      Stocks, MutualFunds, MutualFundDetail, StockDetail,
│   │                      SectorDetail, Transactions, TransactionDetail,
│   │                      Sips, Alerts, Tax, Profile, Login, Register
│   ├── components/        Reusable UI — AppShell, ConnectionBanner, PortfolioSwitcher,
│   │                      DashboardHero, HoldingsHero, StockHero, BenchmarkChart,
│   │                      OnboardingCard, MarketContextBar, MarketStatusBar,
│   │                      SectorSidebar, MarketMovers, FundamentalsCard, FinancialsCard,
│   │                      EventsCard, AboutCard, DividendsCard, WatchlistPopover,
│   │                      HoldingsTable, TradeDialog, AlertForm, NewsFeed,
│   │                      WalletDialog, LiveChart, RangeSelector,
│   │                      MfInvestDialog, MfRedeemDialog, MfMetricsCard,
│   │                      MfReturnCalculator, MfSearchPicker, MfSimilarFunds,
│   │                      SipEditDialog, TickerSearchPicker, …
│   ├── hooks/             TanStack Query + WebSocket (useLivePrices with 100 ms coalesce
│   │                      and 1→30s exponential-backoff reconnect) + useWallet + useGoals
│   │                      + usePortfolioTimeseries + useChartTheme + useInfiniteScroll
│   │                      (callback-ref IntersectionObserver) + misc
│   ├── store/             Zustand (auth, theme, activePortfolio, alertEvents)
│   └── lib/               api client (axios), utils, csv, charges
├── vite.config.ts         Bundle splitting lives here
└── tsconfig.json

docs/                      This folder
```

### Rules of thumb

- **Handler → Service → Repo** is the layering. Handler parses HTTP, Service does business logic, Repo does SQL. Don't reach across layers.
- **Keep packages small.** Every `internal/<pkg>` has a single bounded context. If you find yourself importing `alert` from `sip`, that's a code smell — add a thin interface like user→portfolio did.
- **Migrations are additive.** Add a new numbered pair (`NNN_description.up.sql` + `.down.sql`). Never edit an applied migration.
- **One shared decimal type.** `decimal.Decimal` from `shopspring/decimal` everywhere money is touched. Never `float64`.
- **Auth middleware is the boundary.** Anything under `r.Group(auth.Middleware)` gets `auth.RequireUser(r)` → `uuid.UUID`. Don't read the Authorization header yourself.
- **Indian-market only.** No crypto, no US tickers, no FX. The seed/fixtures and price feeds reflect this.

---

## Common tasks

### Add a new endpoint

1. Decide the domain (existing package or new `internal/foo/`).
2. Add the handler method, service method, and any SQL to the repo.
3. Wire into `cmd/server/main.go`'s route setup — auth group if it needs a user.
4. If you added a package, remember to import it in `main.go`.
5. If the new endpoint serves user-supplied tickers and you want them on
   the live Upstox stream, the worker's `upstoxTickersFn` already
   queries `holdings`, `sip_plans`, and `watchlist`. Add another
   `UNION` if you stored tickers in a new table.

### Add a new migration

```bash
make migrate-new name=add_widgets
# fills in: backend/migrations/<timestamp>_add_widgets.{up,down}.sql
# write the SQL, then:
docker compose --profile tools run --rm migrate up
```

### Add a new env var

1. Add a field to the matching struct in `internal/config/config.go` and read it in `Load()`.
2. Add a default with `v.SetDefault(...)` if sensible.
3. Add the var to `.env.example` **and** `docker-compose.prod.yml` (the `api` or `worker` service, depending on who reads it).

### Add a new frontend page

1. Create `frontend/src/pages/Foo.tsx` exporting `FooPage`.
2. Add a lazy import + route in `App.tsx` — it goes under the `RequireAuth` wrapped group for anything authenticated.
3. Add a sidebar entry in `components/AppShell.tsx` if it's top-level nav.

### Add a new hook

Put it in `frontend/src/hooks/`. One hook per file unless they're tightly coupled. Prefer TanStack Query for anything API-backed — don't `useEffect` + `useState` + `fetch` manually.

### Add a new fundamentals metric

1. Add the field on the matching struct in `internal/fundamentals/fundamentals.go` (Fundamentals / YearlyFinancials / BalanceSheetPeriod / CashFlowPeriod).
2. Add the corresponding read in `mapIncome` / `mapBalanceSheet` / `mapCashFlow`.
3. Bump the cache key prefix (`fundamentals:v2:` → `v3:`) in `Service.Get` so old cached responses get evicted.
4. Wire it into `FundamentalsCard.tsx` or `FinancialsCard.tsx` on the frontend.

---

## Running tests

```bash
# Go — all packages, with race detection
cd backend && go test -race ./...

# Frontend — no unit tests yet. tsc catches the type errors, vite build catches the wiring.
cd frontend && npx tsc --noEmit && npm run build
```

CI runs all of these on every PR — see `.github/workflows/ci.yml`.

---

## Debugging

### "My change didn't take effect"

- **Go changes** — the API server hot-reloads nothing. `Ctrl+C` and `go run ./cmd/server` again.
- **Frontend changes** — Vite HMR should apply instantly. If not, save the file once more or hard-refresh (`Ctrl+Shift+R`).
- **Prod Docker build** — requires a rebuild. `docker compose -f docker-compose.prod.yml up -d --build <service>`.
- **Migrations** — run `docker compose --profile tools run --rm migrate up` any time you add a new migration file.
- **Fundamentals cache** — bump the prefix (`fundamentals:v2:` → `v3:`) in `internal/fundamentals/fundamentals.go` rather than waiting 24 h for TTL.

### Inspect the database

```bash
docker compose exec postgres psql -U stockapp -d stockapp
```

Useful queries:

```sql
-- Who has what?
SELECT u.email, COUNT(h.id) holdings FROM users u LEFT JOIN portfolios p ON p.user_id=u.id LEFT JOIN holdings h ON h.portfolio_id=p.id GROUP BY u.email;

-- Audit trail for a user, most recent first
SELECT action, entity_type, created_at FROM audit_log WHERE user_id = '...' ORDER BY id DESC LIMIT 20;

-- Are my ledger entries balanced per transaction?
SELECT transaction_id,
       SUM(CASE direction WHEN 'debit' THEN amount ELSE -amount END) AS net
FROM ledger_entries
GROUP BY transaction_id
HAVING ABS(SUM(CASE direction WHEN 'debit' THEN amount ELSE -amount END)) > 0.01;

-- What tickers does the worker discover for the dynamic Upstox subscribe?
SELECT DISTINCT ticker FROM holdings WHERE quantity > 0
UNION
SELECT DISTINCT ticker FROM sip_plans WHERE status = 'active'
UNION
SELECT DISTINCT ticker FROM watchlist;
```

### Inspect Redis

```bash
docker compose exec redis redis-cli
> KEYS price:*               # every cached quote
> GET price:RELIANCE         # last tick
> LRANGE price:hist:RELIANCE 0 -1   # ring buffer
> SUBSCRIBE prices:stream    # tail the live stream in real time
> KEYS fundamentals:v2:*     # cached Yahoo quoteSummary blobs
> KEYS candles:*             # cached chart ranges per ticker
```

### Tail logs

```bash
docker compose logs -f postgres
docker compose logs -f redis
# If you run API/worker in containers:
docker compose -f docker-compose.prod.yml logs -f api worker
```

---

## Code style

- **Go**: format with `gofmt` / `goimports` (your editor should on save). Always run `go vet` before committing.
- **TypeScript**: we rely on `tsc --noEmit` to catch things. No ESLint in the repo yet.
- **Comments**: only when the *why* isn't obvious from the name. The package/handler style is consistent — follow what's there.
- **Errors**: wrap with `fmt.Errorf("context: %w", err)` at every layer boundary. Don't lose the cause.
- **No `time.Now()` in business logic that should be testable** — pass a clock if you need one.

---

## Keeping it running

- **Dev**: just stop/start the processes. The Docker infra (postgres + redis) survives reboots (`restart: unless-stopped`).
- **Production**: `docker-compose.prod.yml` has healthchecks + auto-restart on every service. See [`deployment.md`](deployment.md) for hosting options.
- **State persistence**: Postgres and Redis use named volumes (`postgres_data`, `redis_data`). `docker compose down` keeps them; `docker compose down -v` wipes them.
