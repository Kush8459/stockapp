# Architecture

## What shipped

A **modular monolith** that preserves the service seams from the roadmap but
runs as one HTTP server + one background worker. Every package under
`backend/internal/` owns one bounded context and can be lifted into its own
process later with no API change.

```
┌─────────────────────────────────┐  REST/WS   ┌──────────────────────────────┐
│  React (Vite + TS)              │ ─────────▶│  Go HTTP API                  │
│  · dashboard hero · holdings    │            │  · user · portfolio · txn    │
│    hero · stock-detail ribbon   │            │  · pnl · sip · alert · tax   │
│  · stocks/funds browse          │            │  · news · watchlist · div    │
│  · MF detail + heatmap          │            │  · market · sectors · indices│
│  · profile (10 tabs)            │            │  · fundamentals · mf · stocks│
│  · light/dark theme             │◀─────────  │  · wallet · goal · metrics   │
│  · 100 ms-coalesced ticks       │   prices   │  · WebSocket hub             │
│  · WS auto-reconnect (1→30s)    │            │  · /metrics (Prometheus)     │
└────────────┬────────────────────┘            └──────────┬───────────────────┘
             ▲                                             │
             │ on connect                                  ▼
             │                                    ┌────────────────────┐
             │                                    │  PostgreSQL 15     │
             │                                    │  · users / port.   │
             │                                    │  · transactions    │
             │                                    │  · ledger_entries  │
             │                                    │  · audit_log       │
             │                                    │  · watchlists/+    │
             │                                    │  · dividends       │
             │                                    │  · sip_plans       │
             │                                    │  · price_alerts    │
             │                                    │  · wallets         │
             │                                    │  · wallet_txns     │
             │                                    │  · goals           │
             │                                    └────────────────────┘
             │                                              ▲
             │                                              │  (worker discovers
             │                                              │  active tickers
             │                                              │  every 60 s)
┌────────────┴────────────────────┐         ┌───────────────┴────────────────┐
│  Redis 7                        │◀────────┤  Go price worker               │
│  · price:<TICKER>     SET       │         │  · mock | yahoo+mfapi |        │
│  · price:hist:<TICKER> LIST     │         │    upstox v3 WS                │
│  · prices:stream      PUB/SUB   │         │  · dynamic per-user subscribe  │
└─────────────────────────────────┘         └────────────────────────────────┘

           ┌─────────────────────────────────────────┐
           │  Observability (--profile observability)│
           │  Prometheus  ──scrapes──▶  /metrics     │
           │   Grafana    ──reads──▶   Prometheus    │
           └─────────────────────────────────────────┘
```

## Key design choices

### Modular monolith instead of 8 services

The roadmap calls for a service per domain (user, portfolio, transaction,
price ingestion, P&L, SIP, alert, notification). That is the right *logical*
decomposition — but it is not the same question as process decomposition.

We keep the package boundaries (`internal/user`, `internal/portfolio`, …)
but run them in one binary. This gives us:

- **No RPC stubs, no Kafka topics, no service mesh** — ship faster.
- **Atomic transactions across domains** (e.g. transaction + ledger + audit
  all write under the same `BEGIN`), which is hard across services.
- **Still extractable** — the dependency graph only points inward
  (`transaction` and `portfolio` depend on `price`; nothing depends on
  `user` except through narrow interfaces).

When one package's throughput exceeds the others (price ingestion is the
obvious candidate) we extract that package behind a gRPC + Kafka boundary
without touching its callers' logic.

### Real-time prices: Upstox v3 WebSocket, not REST polling

The price worker authenticates against `/v3/feed/market-data-feed/authorize`
to get a one-time signed `wss://` URL, then opens a single WebSocket. A
hand-rolled protobuf wire-format decoder reads `feeds[<key>].ltpc` (last
traded price + close) from each binary frame.

A few things had to be right to make 500-ticker live streaming reliable:

- **Connection state with a write mutex.** Concurrent goroutines (refresh,
  ping ticker, snapshot dispatcher) all write to the same WS — they share
  one `writeMu` to serialise writes. WebSocket frames cannot interleave.
- **Ping / pong every 10 s.** Without an explicit ping, Upstox closes the
  socket after ~24 s of idle. We send the first ping immediately after
  subscribe so the connection survives the silent post-open window.
- **Incremental sub/unsub.** A 60 s goroutine re-runs the ticker discovery
  closure (MockUniverse + indices.AllTickers + DB query of holdings/SIPs/
  watchlist), diffs against `subscribed`, and sends only the delta. New
  buys join the stream within a minute without a reconnect.
- **Snapshot pipeline.** The Upstox WS only ships *changes* — there is no
  "current price" frame on subscribe. We seed Redis from Upstox's batched
  v2 REST (`/market-quote/quotes`, 100 keys per call), then gap-fill via
  Yahoo for any tickers Upstox missed (and for indices that Upstox returns
  `0` for off-hours).

### Snapshot replay on WebSocket connect

`price.Hub.Handler` ships every cached quote to a freshly connected client
before streaming live events. Without this, a dashboard that loaded
mid-day would paint `₹0` for everything until the next tick on each ticker.

The implementation takes care to start the read/write pumps *before*
sending the snapshot — earlier versions used a `default:` case on the
buffered channel that silently dropped quotes past the 256-message buffer
when the client was rebroadcasting 500 stocks. Now snapshot dispatch is a
goroutine with a 2 s blocking timeout per message, which trades a slow
client's connection for guaranteed delivery to fast ones.

### `SELECT FOR UPDATE` + SERIALIZABLE

`transaction.Service.Execute` runs under `IsoLevel: Serializable` and starts
with `SELECT … FROM holdings WHERE … FOR UPDATE`. Two concurrent sells of
the same position serialize on the row lock; the second one sees the
updated quantity and either succeeds with the remaining balance or rejects
with `insufficient_quantity`. Serializable catches the rarer write-skew
case where two different updates interact through the ledger.

### Double-entry alongside transactions

The `transactions` table is the canonical business record. Every write also
produces two (or more, with fees) rows in `ledger_entries`:

| account            | debit   | credit  |
|--------------------|---------|---------|
| positions:RELIANCE | 25 000  |         |
| cash               |         | 25 000  |

A buy debits the position, credits cash. Sell is the mirror. Summing debits
and credits by user at any point in time must yield zero.

### Append-only audit log

`audit_log` has triggers that reject `UPDATE` and `DELETE`. This is
defence-in-depth (a role with `bypass_trigger` can still override), but it
catches accidental writes from ORMs or bulk scripts.

### Redis, not Postgres, for live prices

Every ticker produces a quote every couple of seconds. Writing that to
Postgres is both wasteful (thousands of rows/minute per ticker) and slow
(page splits on a hot index). Redis `SET` is O(1) and keeps only the most
recent value. Per-ticker ring buffers hold the last 240 ticks (24 h TTL)
for the 1D chart seed.

### WebSocket fan-out from Redis pub/sub

The price worker publishes every tick on the `prices:stream` channel; the
HTTP server subscribes once per process and re-broadcasts to every
connected browser. One Redis subscription per API pod, not per client —
that's the scaling unit.

Per-user filtering (only sending a user the tickers they hold) is the next
obvious optimization, but at the current universe size the 100 ms client
coalescing buffer absorbs the volume.

### Indian-format compact numbers

`formatCompact` in `frontend/src/lib/utils.ts` formats `₹k → ₹L (lakh) →
₹Cr (crore) → ₹LCr (lakh-crore, ₹1 trillion)` and drops decimals once the
integer part has 4+ digits. Reliance-scale numbers (₹9 lakh crore revenue)
fit on a chart Y-axis as `₹9LCr`; small caps still get `₹12.34Cr`. This
matches what Indian users see in Groww / Zerodha / IndMoney.

### Yahoo `quoteSummary` for fundamentals

Upstox's public API doesn't expose fundamentals or financials — it's a
broker feed. So the fundamentals package goes straight to Yahoo's
`quoteSummary` endpoint with 11 modules in one round trip
(`summaryDetail`, `defaultKeyStatistics`, `summaryProfile`,
`financialData`, `calendarEvents`, `incomeStatementHistory(+Quarterly)`,
`balanceSheetHistory(+Quarterly)`, `cashflowStatementHistory(+Quarterly)`).

`quoteSummary` requires a "crumb" cookie session to work. A small session
manager (`fundamentals/session.go`) does the dance — `GET fc.yahoo.com`
to seed the cookie jar, then `GET getcrumb` for the magic string — and
refreshes every 30 minutes under a `sync.Mutex`.

Cache is keyed `fundamentals:v2:<TICKER>` (24 h TTL); the v2 prefix lets
us invalidate the entire cache without flushing other Redis keys.

### Why so many tickers (NIFTY 500 + watchlist + holdings)

The Upstox subscribe set is dynamic — every ticker any user owns or
watches plus every NIFTY 500 constituent. The instruments CSV
(`https://assets.upstox.com/.../complete.csv.gz`, ~9 000 NSE equities) is
loaded into RAM at worker startup and powers two things: the search
endpoint's local index, and key lookup (`LookupUpstoxKey`) for the WS
subscribe payload. Same load also populates a `bySymbol` map for O(1)
`LookupInstrument(ticker)` calls, used by `/stocks/catalog` to enrich
cards with company names.

Loading happens at worker startup with a 30 s blocking timeout. This is
worth the slight startup delay because subscribing later (after the WS
is open) leaks a "snapshot only contains 33 stocks" bug — the snapshot
dispatch needs the full set to be known.

### Mutual funds via the AMFI mirror

Upstox doesn't cover AMFI mutual funds. The `internal/mf` package fills
that gap with one external dependency — `api.mfapi.in`, a public mirror
of AMFI's daily NAV file. **No fund list is hardcoded**: at API-server
boot, `mf.Service.Start` fetches the directory (~13 000 schemes), filters
to Direct Plan + Growth, buckets each into one of 21 categories via
name-keyword matching (`mf.classify`), and caches the result in Redis
under `mf:directory:v2` for 24 h.

Tickers for MFs use a canonical `MF<schemeCode>` form (e.g., `MF120586`).
`price.ParseMFTicker` and `IsMFTicker` recognise this shape across the
codebase, so transactions, SIPs, and the price worker all dispatch to
mfapi without per-fund mapping. The four legacy short tickers
(`AXISBLUE`, `PPFAS`, `QUANTSM`, `MIRAE`) still resolve via a small
back-compat map for any existing seed data.

Real-time NAVs flow the same way stocks do — through the price.Cache +
WebSocket fan-out — but the discovery set is built differently. The
worker calls `mfTickerDiscovery(ctx, db)` each tick: legacy `MFSchemes`
keys ∪ DB query of `holdings WHERE asset_type='mf' AND quantity > 0` ∪
`sip_plans WHERE asset_type='mf' AND status='active'`. New MF buys join
the live-NAV stream within one mfapi poll interval (30 min) without a
worker restart. AMFI publishes one NAV per scheme per trading day, so
30 min is the right poll cadence — anything faster wastes upstream calls.

Returns and risk metrics (`/mf/funds/{ticker}/returns` and
`.../metrics`) compute from the same Redis-cached full NAV history
(`mf:history:full:{code}`, 24-h TTL). One upstream fetch supports both
endpoints plus the `RangeMax` chart request — they share a single
`navPoint` series.

### Stocks browse: composition, not new data

`internal/stocks` is a thin adapter that exposes browse-style endpoints
(`/stocks/categories`, `/stocks/catalog`) over data that already exists
elsewhere: `indices.Tickers(slug)` for index/sector membership,
`price.Cache.GetMany` for live quotes, `price.LookupInstrument` for
company names, `price.SearchInstrumentsPaged` for the universe-search
fallback. No new external dependency, no new package state.

Sectoral indices use the **same NSE-archives loader** as broad indices.
The `Index.Category` field (`"broad"` | `"sector"`) splits them in the
categories endpoint, but the `resolveCategory` code path is identical
for `index:nifty50` and `sector:niftybank` — both call `indices.Tickers`.
This deliberately replaces the older curated `internal/sectors` map for
the new browse surface. (The old `/sectors` endpoint is kept for the
right sidebar's back-compat, since it returns a slightly different shape
with index quote + per-component quotes in one payload.)

The catalog endpoint paginates with `?offset=&limit=` so the frontend's
`useInfiniteQuery` can lazily load the long tail. For movers categories
the sort happens before the slice, keeping pagination order stable
within a session even as prices move.

### Wallet inside the trade transaction

Every trade now writes a wallet movement **inside the same outer
SERIALIZABLE transaction** as the holdings update and the ledger pair.
That makes the wallet→holdings→ledger triple atomic under arbitrary
concurrency:

1. `transaction.Service.Execute` opens a tx at SERIALIZABLE isolation.
2. `SELECT FOR UPDATE` on the holding row (or no row, on a first buy).
3. `SELECT FOR UPDATE` on the wallet row via `wallet.ApplyTradeInTx`.
4. Compute charges (`wallet.ComputeCharges`) + net amount.
5. Insert the transactions row with brokerage + statutory + net columns.
6. Insert the wallet_transactions row + bump the wallet balance.
7. Insert the double-entry ledger pair.
8. Append `transaction.create` to `audit_log`.
9. Commit, or roll the whole thing back.

`ErrInsufficientBalance` from the wallet path bubbles out as a
`422 insufficient_balance` to the client — the user never sees a partial
state. SIPs catching this error pause themselves with a `pause_reason`
column rather than burn audit rows retrying every minute.

### Portfolio time-series replay

The benchmark-comparison chart needs a portfolio value series for any
range up to "all". Computing this exactly requires walking every
transaction in order and pricing the running holdings at each day's
close. `portfolio.Service.TimeSeries`:

1. Pulls every transaction for the portfolio, oldest first.
2. Pulls 5y EOD candles for each unique ticker once (Yahoo for stocks,
   mfapi for MFs) — Redis cached, so a re-render is one query each.
3. Builds `ticker → date → close` maps, plus a sorted-dates index for
   "last close on or before D" lookups (handles weekends and holidays).
4. Walks weekdays from the first transaction to today; on each day,
   applies trades executed on or before, then `Σ units × close-on-date`.
5. Trims to the requested range before returning, but the replay always
   starts from the first transaction so cost basis is accurate.

Tickers with no candle data fall back to the user's avg buy price so a
fund with missing-data doesn't drag the line to zero — honest, but
soft.

### Multi-portfolio without a DB column

The `portfolios` table already supported `(user_id, name)` uniqueness.
The active-portfolio selection lives **client-side only** — a zustand
store persisted in localStorage. The clever bit: `usePortfolios()`
reorders its result so the active portfolio sits at index 0, which
means every existing `portfolios.data?.[0]` callsite (11 of them) picks
up the user's selection without any further wiring. One source of truth
on the client; no schema migration; no extra column to keep in sync.

The audit-trail-safe `DELETE /portfolios/{id}` refuses to drop a
portfolio that has any transactions (cascading would silently destroy
the ledger). It also refuses to leave the user with zero portfolios.
SIPs and holdings cascade via FK.

### Observability is opt-in

Metrics live in `internal/metrics`, registered against a custom registry
so `/metrics` doesn't expose duplicated runtime metrics. The HTTP
middleware uses chi's matched route pattern (`/portfolios/{id}`) as the
label, not the raw URL — keeps cardinality bounded across UUIDs.

Prometheus + Grafana are gated behind `--profile observability` so they
don't run in the default dev loop. `make obs-up` brings them up; they
scrape the natively-running API via `host.docker.internal:host-gateway`.
The Grafana dashboard is provisioned from `infra/grafana/dashboards/`,
auto-loaded on first start.

The interview-grade panel is **trade execute latency** — the histogram
covers the SERIALIZABLE path including the FOR UPDATE wait, so a screen
of p99 over time tells the story of "what does contention look like
under load".

## What's deferred

| Feature            | Why deferred                                                  |
|--------------------|---------------------------------------------------------------|
| Kafka event bus    | In-process pub/sub is enough for one node                     |
| Polygon ingestion  | Needs API key; Upstox v3 WS already covers Indian equities    |
| OpenTelemetry traces | Prometheus metrics in; OTel traces would surface the FOR UPDATE wait per-trade |
| Per-user WS filter | Currently broadcasts every ticker; coalescing buffer mitigates|
| Idempotency keys   | `Idempotency-Key` header → Redis dedupe table is half-day work|
| Limit orders       | Only `market` side today; an in-process matcher is on the list|

## Extraction path

When it's time to split to services:

1. **`cmd/price-worker`** is already its own binary. Swap Redis pub/sub for
   Kafka `price.updated` topic partitioned by ticker.
2. **`internal/pnl`** becomes `cmd/pnl-engine`: consume `price.updated`,
   produce `portfolio.updated` partitioned by `user_id`.
3. **`internal/price/ws.go`** (the hub) becomes `cmd/notification-service`:
   consume `portfolio.updated`, fan-out to WebSockets.
4. **`internal/fundamentals`** is already side-effect-free — lift it as-is
   into a separate read-only service if Yahoo rate-limits become an issue.
5. The monolith keeps auth + portfolios + transactions + watchlist +
   dividend; those are the user-visible synchronous writes.

None of the internal Go interfaces change.
