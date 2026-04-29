# Troubleshooting

The errors we've actually run into building this — with the fix inline,
not just the symptom. Grep this page before opening an issue.

---

## Docker / infra

### `target api: failed to solve: go mod download: go.mod requires go >= 1.25.0`

The backend Dockerfile pins an older Go than `go.mod` declares. Fix:

```dockerfile
# backend/Dockerfile
FROM golang:1.25-alpine AS builder      # match go.mod's `go 1.X.Y`
```

Also bump `go-version` in `.github/workflows/ci.yml` to the same version.

### `port is already allocated` / `bind: address already in use`

Something on your host is on 5432, 6379, 8080, or 8081. Either kill it or
remap the Docker-side port in `docker-compose.yml`:

```yaml
ports:
  - "5433:5432"   # host 5433 → container 5432
```

Then update `.env` so the API talks to the right port: `POSTGRES_PORT=5433`.

On Windows, the most common offender is a local Windows Postgres service:

```powershell
Get-Service -Name *postgres* | Stop-Service    # as administrator
```

### `failed SASL auth: FATAL: password authentication failed for user "stockapp"`

Your API is hitting a different Postgres than the one Docker started —
typically a local Windows Postgres on 5432 with different credentials.
Either stop it (above) or set `POSTGRES_PORT=5433` in `.env` and bind the
Docker one to host port 5433.

### API 500s on every write with `column … does not exist`

Migrations haven't been applied. Run:

```bash
docker compose --profile tools run --rm migrate up
```

If the `migrate` service errors with a "dirty" state, force to the last
known good version and re-apply:

```bash
docker compose --profile tools run --rm migrate force 1
docker compose --profile tools run --rm migrate up
```

### `docker compose up` succeeds but the frontend shows "Network error"

CORS. The API's `APP_CORS_ORIGINS` isn't allowing the browser's current origin.

- **Prod compose** — set `APP_CORS_ORIGINS=http://localhost:8081` in `.env`, `docker compose -f docker-compose.prod.yml up -d api` to reload.
- **Dev (5173)** — the default `APP_CORS_ORIGINS=http://localhost:5173` works. If you changed it, set it back.

Confirm with:

```bash
curl -i -H "Origin: http://localhost:8081" http://localhost:8080/healthz
# Response should include: Access-Control-Allow-Origin: http://localhost:8081
```

---

## Auth

### Login works in dev but not prod

Invariably one of:

- `JWT_SECRET` is different across restarts → previously-issued tokens fail. Pick one and keep it.
- Frontend built with the wrong `VITE_API_URL` — rebuild: `docker compose -f docker-compose.prod.yml up -d --build frontend`.
- HTTPS mixing: frontend on `https://` but the WS URL is `ws://`. Browsers require `wss://` from HTTPS. Rebuild with `VITE_WS_URL=wss://…`.

### `JWT_SECRET is required`

You deleted `.env` or the variable is commented. Generate one:

```bash
openssl rand -hex 32
# paste into .env as:   JWT_SECRET=<that-string>
```

Must be at least 32 chars (we enforce).

---

## Buy / sell returns 500 "internal error"

The two we've actually debugged:

1. **Migration 2 not applied.** `source` / `source_id` columns missing →
   INSERT fails → transaction rolls back. Fix: run migrations.

2. **`audit_log.ip` rejects `IP:PORT`.** The handler's `clientIP(r)` used
   to return `r.RemoteAddr` directly, which includes the port. Postgres
   INET rejects it; the whole transaction rolls back. Fixed in
   `transaction/handler.go` — `clientIP` now strips the port via
   `net.SplitHostPort`.

Either way, **check the API log** for the actual error — `httpx.Error` logs
unhandled errors before returning 500:

```
ERR unhandled error error="..." path=/api/v1/transactions
```

---

## Prices

### Dashboard shows ₹0 for everything

Price worker isn't running, OR you just connected before the snapshot
replay finished. The hub now ships every cached quote on connect, so
this should self-heal within a second. If it doesn't:

```bash
cd backend && go run ./cmd/price-worker
# or docker compose -f docker-compose.prod.yml ps  → check worker is Up
```

Give it ~30 s on the Upstox path (it blocks startup on the instruments
CSV + index loaders), then refresh the browser.

### Searched ticker shows ₹0 even though the chart has data

The WebSocket stream only carries tickers the worker is subscribed to.
The dynamic-subscribe goroutine re-runs every 60 s — visiting a stock
page after a fresh search means waiting up to a minute for the next
subscribe cycle, OR the stock isn't on Upstox so it falls back to the
Yahoo poll loop.

The stock-detail hero falls back to the last candle's close in the
meantime. If you still see 0, your `useCandles` hook failed — open the
Network tab and inspect the response from
`GET /api/v1/quotes/<ticker>/candles?range=1y`.

### Top movers card is empty / shows the same stocks regardless of filter

- **Empty:** the worker hasn't seeded the cache yet OR you're filtering
  to an index whose constituents haven't loaded. Check
  `/api/v1/market/indices` — it only lists indices with loaded constituents.
- **Same stocks for gainers and losers:** sign filter wasn't applied.
  Fixed in `market/handler.go` — gainers must have `changePct > 0`,
  losers `< 0`. Off-hours zero-change tickers correctly fall out of both.

### NIFTY 50 / Bank Nifty chart shows 0% off-hours

Yahoo returns `regularMarketPrice: 0` for some indices off-hours. The
fallback walks `indicators.quote[0].close` for the most recent non-zero
close. If you see `0%` regardless of time-of-day, check that the index
ticker is in `MockUniverse` (so the worker fetches it) and that
`/api/v1/quotes/<INDEX>` returns a non-zero price — Yahoo's index symbol
mapping (`^NSEI`, `^BSESN`, `^NSEBANK`, `^CNXIT`) is in `internal/price/yahoo.go`.

### Yahoo returns 429 / 403

Unofficial endpoints throttle you if you poll too aggressively. Options:

- Raise the poll interval in `cmd/price-worker/main.go` (currently 30 s for stocks)
- Switch `PRICE_SOURCE=mock` temporarily
- Switch `PRICE_SOURCE=upstox` (official feed; needs a daily token — see below)
- Wait ~10 minutes

---

## Upstox

### `UPSTOX_API_KEY and UPSTOX_API_SECRET must be set in .env`

You ran `cmd/upstox-login` without filling in your Upstox app credentials.
Create a Stockapp app at <https://account.upstox.com/developer/apps> with
redirect URL `http://localhost:8080/api/v1/integrations/upstox/callback`,
then paste the API key + secret into `.env`.

### `can't listen on 127.0.0.1:8080: ... (is the API server still running?)`

The login helper binds to whatever port `UPSTOX_REDIRECT_URL` points at
(8080 by default), which collides with the API server. Stop the API
(Ctrl-C in its terminal), run `make upstox-login`, paste the printed
token into `.env`, then start the API back up.

### Price worker logs `upstox-ws: 401 — token expired? re-run cmd/upstox-login`

Upstox tokens expire daily at ~3:30 AM IST. Refresh:

```bash
# stop the API server first (the helper listens on 8080)
make upstox-login
# paste the printed UPSTOX_ACCESS_TOKEN=… line into .env
# restart API + worker
```

### WS disconnects ~24 s after subscribe

We saw this when the ping cadence was too slow. The worker now sends:

1. An immediate ping right after subscribe (closes the silent post-open window)
2. A ping every 10 s

If you regress this, the symptom is `upstox-ws: read: ... going away` ~24 s
after the worker boots. Check `runOneUpstoxWS` in
`internal/price/upstox_ws.go` for the ticker.

### `accepted=0` from the instruments CSV loader

Earlier versions filtered the CSV by trusting the `exchange` column,
which Upstox repurposed across CSV revisions. Fixed in
`internal/price/upstox_instruments.go` — we now filter by
`instrument_key` prefix (`NSE_EQ|`) instead. If you see `accepted=0`,
verify your CSV download isn't a partial body.

### Snapshot only seeds ~30 stocks instead of 500

Worker startup must complete the universe loaders BEFORE the WS dispatch
runs, or the snapshot only sees MockUniverse. The fix: a `sync.WaitGroup`
in `cmd/price-worker/main.go` blocks for both `LoadUpstoxInstruments`
and `indices.LoadAll` (with a 30 s timeout) before calling
`runUpstoxFeeds`. Don't move that off the critical path.

### Browser receives only the first ~256 quotes on connect

The hub's per-client write channel is buffered at 256. Earlier code used
a `default:` case to drop overflow silently — visible as "I see 256
quotes then nothing." Fixed by sending the snapshot in a goroutine that
blocks (with a 2 s per-message timeout). See `price/ws.go:Hub.Handler`.

---

## Search

### Search returns nothing for valid tickers

The local Upstox index hasn't finished loading. Both the API server and
the price worker load their own copy of the CSV in the background — if
the API is on a slow link, search falls back to Yahoo, which is fine but
slower. Confirm with:

```bash
curl 'http://localhost:8080/api/v1/search?q=reliance&limit=5'
```

If you see `RELIANCE.NS` (Yahoo shape) you're on the fallback. If you
see `RELIANCE` (our cleaned shape) you're on the local index.

---

## Watchlists

### "Add to watchlist" star does nothing

The browser silently 401'd because the user wasn't logged in. The star
button calls `/api/v1/watchlists`, which is auth-required. Check
DevTools → Network for the 401 and re-login.

### Star button popover shows no lists

`/api/v1/watchlists` auto-creates "My Watchlist" on first call, so an
empty popover means the response is being squashed. Check that the
endpoint isn't returning 401 (auth issue) or 500 (DB connection issue).

---

## Dividends

### `/dividends/suggested` returns an empty list

Either:

1. **The user didn't hold shares on the ex-date.** That's the filter — we
   only suggest dividends where `sharesOnDate > 0`. If the user bought
   after the dividend they wouldn't have received it.
2. **Yahoo `events=div` returned nothing.** Check the response of
   `https://query1.finance.yahoo.com/v8/finance/chart/<TICKER>.NS?range=5y&events=div`.
   Some tickers don't broadcast dividend events through Yahoo (newly
   listed names, infrequent payers).

### Imported amount is wrong

The auto-suggest computes `perShare × sharesOnDate`. Two things to check:

1. `sharesOnDate` reflects the user's holdings as of the *ex-date* (not
   pay-date). Confirm against the transactions table.
2. The dividend was a stock split or bonus, not cash. Yahoo lumps these
   together; we currently treat anything from `events=div` as cash.

---

## Fundamentals & financials

### Card says "No data"

`internal/fundamentals.Service.Get` returns 200 with empty fields when
Yahoo `quoteSummary` succeeds but ships nothing for that ticker — the
card must handle that gracefully, not show a stack trace.

If you're seeing it for *every* stock, the crumb dance failed. Check
worker/api logs for `crumb refresh:` errors.

### Always 0 for "Gross Profit"

Indian-listed companies typically don't break out gross profit
separately on Yahoo. The Financials card filters out metrics with
zero across every visible period (`availableMetrics` in
`FinancialsCard.tsx`) — if you regressed this filter, you'll see flat
zero lines for missing metrics.

### Y-axis labels overflow ("₹900000.00Cr")

`formatCompact` in `lib/utils.ts` was missing the lakh-crore (LCr)
tier. Fixed: values ≥ 1e12 render as `₹9LCr`, decimals dropped once the
integer part has 4+ digits. Y-axis width also bumped from 64 → 78 px in
`FinancialsCard.tsx`.

### Fundamentals show stale numbers

Cache is keyed `fundamentals:v2:<TICKER>` with a 24 h TTL. To force-flush
without waiting:

```bash
docker compose exec redis redis-cli --scan --pattern 'fundamentals:v2:*' | xargs docker compose exec -T redis redis-cli DEL
```

Or bump the prefix to `v3:` in `internal/fundamentals/fundamentals.go`.

---

## News

### `/news/:ticker` returns 503 `news_disabled`

No `NEWSAPI_KEY` in `.env`. Get a free key at https://newsapi.org and add:

```
NEWSAPI_KEY=your32charkey
```

Restart the API.

### News comes back generic / wrong company

Our ticker→query override map only has ~10 known Indian names. For any
other, NewsAPI searches for the raw ticker (e.g. "TCS") which returns noise.

Fix: add a row in `internal/news/service.go`:

```go
var queryOverrides = map[string]string{
    ...,
    "YOURTICKER": "Full Company Name",
}
```

Rebuild the API.

---

## Wallet / SIPs / migrations

### `column "pause_reason" does not exist (SQLSTATE 42703)` once a minute in logs

The SIP scheduler is running, but `migrations/000008_sip_pause_reason.up.sql`
hasn't been applied. Run:

```
make migrate-up
```

After it applies, the warning stops and the SIP auto-pause-on-low-balance
flow becomes functional.

### `relation "wallets" does not exist`

Same fix — `migrations/000007_wallet.up.sql` introduced the wallet
schema. `make migrate-up` brings everything up to date in order.

### Trade returns `422 insufficient_balance`

Working as designed. Buys debit the wallet (qty × price + brokerage +
statutory + GST). Top up via `POST /api/v1/wallet/deposit` or the Add
funds button in the sidebar. The seed bonus is ₹1,00,000.

### Existing user shows ₹0 wallet balance after the wallet migration

The migration backfills every row in `users` with a ₹1,00,000 deposit.
If a user is missing one, check that `EnsureForUser` is being called
(it's invoked lazily on the first `GET /wallet`). Worst case, trigger
it by hitting `/api/v1/wallet` while authenticated as that user.

### Existing SIP is paused with a "Low wallet balance" badge

The scheduler tried to debit the wallet at SIP-run time and got
`ErrInsufficientBalance`. The plan flipped to `paused` with
`pause_reason = 'insufficient_balance'`. Top up the wallet then resume
the SIP from the Sips page (resume clears `pause_reason` automatically).

---

## Frontend

### Huge JS bundle / slow first paint

Already addressed — see Vite `manualChunks` in `vite.config.ts` plus
`React.lazy()` routes in `App.tsx`. Main entry should be ~125 KB.

If you changed Vite config and it regressed, `npm run build` prints the
per-chunk sizes. Look for anything unexpected over 500 KB.

### Chart "T7" watermark still shows

Lightweight-charts v5 adds `layout.attributionLogo: false`. Already set in
`components/LiveChart.tsx`. If it reappears, check you're on v5+:

```bash
cd frontend && grep lightweight package.json
# should be ^5.x
```

### Clicking a stock from mid-dashboard scrolls to the same position

Fixed by `<ScrollToTop>` in `App.tsx` — uses `useLocation` + a
`window.scrollTo({ top: 0, behavior: "instant" })` effect on every
pathname change.

### "₹₹" doubled rupee symbol on hero values

`formatCompact` already prepends `₹`; some call sites added another. Fix:
just call `${formatCompact(value)}`, never `₹${formatCompact(value)}`.

### WebSocket doesn't reconnect after server restart

Browser-side: there's no auto-reconnect yet. Hard-refresh the page or
log out/in. TODO: add a reconnect-with-backoff loop in `useLivePrices`.

### "Cached error state" — Refresh button does nothing

Was an actual bug on the AI review card where TanStack Query held an
error result and `refetch` didn't re-fire. Fixed by switching the
Refresh button to always call the POST `/refresh` mutation instead of
`refetch`. If you see it elsewhere, use the mutation pattern.

---

## Tax report

### Empty realizations table

You don't have any sells. Tax realizations only appear after a FIFO-matched
sell against a buy. Go to the dashboard, sell a few units of anything,
come back.

### XIRR shows `—` for everything

Either zero transactions (seed data has backdated buys, check you ran
`go run ./cmd/seed`) or the cash flows span too short a timeline
(<1 day). The backend clamps XIRR to the ±500%/yr range so tiny windows
don't extrapolate to absurd percentages.

---

## Still stuck?

1. `docker compose ps` — all services `Up (healthy)`?
2. `docker compose logs <service> --tail 50` for the one that's complaining.
3. Browser DevTools → Network tab → find the failing request. Status + response body tell you exactly what happened.
4. If you're on the prod Docker stack, the API's errors go to `docker compose -f docker-compose.prod.yml logs api` — not your terminal.

If after all that it's still broken, grab the API log lines from the last
failing request + paste them into a new issue.
