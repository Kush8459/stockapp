# Next phases

What's left to build, ordered roughly by value-per-effort. Each phase is
independent — pick whichever matters most when you sit down.

> The original product spec lives in [`roadmap.md`](roadmap.md). That's
> the historical "what we set out to build". This doc is the forward-looking
> "what's still to do".

---

## Where we are

Phases 1–3 of the original roadmap are done. Phase 4 is mostly done
(XIRR display, CSV export, allocation analysis, audit log).

Beyond the original roadmap we've also shipped: tax P&L, AI insights
(Gemini), multi-list watchlists, dividend tracking with auto-suggest,
fundamentals + financials (Yahoo `quoteSummary`), market context bar,
11-sector heatmap, NIFTY-filterable top movers, dynamic Upstox subscribe
across ~9 000 NSE equities.

**Recent additions** (since the last roadmap revision):

- **Mutual funds catalog** (`/funds`) — full AMFI directory loaded from
  mfapi.in, 21 categories, per-fund detail page with returns table
  (1M / 3M / 6M / 1Y / 3Y / 5Y / 10Y / since-inception), risk metrics
  (volatility, Sharpe, max drawdown, calendar-year + rolling 1Y returns),
  return calculator (Lumpsum / SIP), similar-funds rail.
- **Stocks browse** (`/stocks`) — Movers / Indices / Sectors chips, live
  market-mood pill, tick-flash animation per card, market-aware
  freshness footer. Sectoral indices loaded dynamically via the same
  NSE archives path as broad indices (no curated list).
- **Infinite scroll** — `useInfiniteQuery` + IntersectionObserver
  callback ref on both `/funds` and `/stocks`. Backend offset-paginated.
- **MF-only SIP picker** + monthly/yearly-only frequencies + start-date
  picker + edit existing SIPs. PATCH `/sips/{id}` accepts a partial body.
- **Live MF NAVs** — price worker discovers held + active-SIP MF tickers
  every poll and includes them in the mfapi feed (same dynamic-discovery
  pattern stocks already use).
- Search behavior unified between the home bar and `/stocks` (Yahoo
  fallback when the local Upstox CSV has zero hits).

See [`features.md`](features.md) for the full inventory of what's shipped.

---

## Phase F — Benchmark comparison

**Effort:** ~2 days · **Value:** high · **Risk:** low

Every Indian retail app shows "your portfolio vs NIFTY 50 since you
started". We don't. Hits existing candle endpoint, read-only.

- Overlay NIFTY 50 / SENSEX series on the holdings P&L chart
- "Your portfolio vs NIFTY 50 since you started" delta on dashboard
- Per-stock chart toggle: "vs sector index" (TCS vs NIFTY IT, etc.)
- Dropdown for the benchmark: NIFTY 50, NIFTY 100, NIFTY 500, SENSEX, sector
- Tooltip showing both series at the hover point

**Files likely touched:**
`frontend/src/components/LiveChart.tsx`, `pages/Dashboard.tsx`, new
`hooks/useBenchmark.ts`, `internal/portfolio/service.go` (compute
portfolio time-series from transactions + close prices).

---

## Phase G — Multi-portfolio + goals

**Effort:** ~3–4 days · **Value:** medium · **Risk:** medium

Schema already supports multiple portfolios per user; the UI is
single-portfolio.

- Portfolio switcher in the `AppShell` header
- "New portfolio" / "Rename" / "Delete" affordances
- Goals: name, target corpus, target date, linked SIPs/holdings →
  progress bar + on-track / off-track verdict using current XIRR
- Bucketed views: "Retirement", "Tax saving", "Emergency", "Trading"
- Aggregated dashboard view across portfolios (opt-in)

**Schema impact:** new `goals` table with FK to `portfolios`. SIP and
holding linkage already in place.

---

## Phase H — Onboarding & empty states

**Effort:** ~1–2 days · **Value:** high · **Risk:** low

New users land on an empty dashboard with no nudges. The product is
opaque until they manually add transactions.

- 3-step onboarding overlay: search a stock → add a transaction → set up SIP
- Better empty states everywhere ("No alerts yet — set one to track
  RELIANCE crossing ₹2 500" with a working CTA)
- "Try with demo data" button that loads the seed portfolio for a guest
  account
- Tooltips on first hover for XIRR / day-change / FY-tax columns

---

## Phase I — WebSocket resilience

**Effort:** ~half day · **Value:** medium · **Risk:** low

We've kicked this can since Phase 1.

- Browser auto-reconnect in `useLivePrices` with exponential backoff
  (1s → 30s cap)
- Visual indicator when disconnected (the dot in the sidebar already
  exists — also surface a banner if reconnect takes >5 s)
- Reconcile missed `alert.triggered` events via `GET /alerts` after
  reconnect (currently we'd silently miss them)
- Backend already pings every 30 s — no server-side change needed

---

## Phase J — Production polish & deploy

**Effort:** ~2–3 days · **Value:** highest · **Risk:** low

The product is feature-rich; what's missing is the thing that makes
someone reading the CV actually click through.

- Pick a host (Hetzner VPS recommended — cheapest + best CV story; see
  [`deployment.md`](deployment.md))
- Live URL with HTTPS via Caddy
- Add `LICENSE` (MIT)
- README screenshots — Dashboard, Holdings, Stock detail (with
  fundamentals + financials), Watchlist, Tax
- 90-second demo video / GIF showing live ticks + buy flow + SIP
  setup + AI review
- UptimeRobot on `/healthz` (free)
- Tighten security: rate-limit `/auth/login` and `/auth/register`,
  HSTS header, stricter CSP
- Update repo description + topics on GitHub

---

## Phase K — Observability

**Effort:** ~1–2 days · **Value:** medium · **Risk:** low

Useful interview signal; not user-visible.

- Prometheus metrics endpoint on API + worker
- Counters: WS connections, ticker subscribe count,
  Yahoo/Upstox error rates by endpoint
- Histograms: request latency by route, WS message latency
- Grafana board (provision via JSON in `infra/`)
- Compose service for Prom + Grafana behind a `--profile observability`
- Add OpenTelemetry traces to the SERIALIZABLE transaction path —
  shows the SELECT FOR UPDATE wait time clearly

---

## Phase L — Mobile responsive

**Effort:** ~1–2 days · **Value:** medium · **Risk:** low

Stock detail page already roughly works on mobile; dashboard +
holdings + sector sidebar need work.

- Sidebar collapse / hamburger on `<md`
- Sector sidebar hidden on `<lg` (or moved to a slide-out)
- Tables → stacked cards on `<md` for Holdings, Transactions, Tax
- Tap-targets ≥ 44 px (some star + edit buttons are smaller)
- Test on iPhone SE width (375 px) — current breakage is the main bar

---

## Phase M — Paper trading mode

**Effort:** ~2 days · **Value:** medium · **Risk:** low

Lets visitors try the app without registering or risking real holdings.

- "Demo" toggle that swaps to a separate portfolio with seeded
  virtual cash
- Same buy/sell/SIP/alert logic, labeled "Paper" in the UI
- Reset button to wipe and re-seed the demo portfolio
- Useful for the demo video and for the live deploy's homepage

---

## Smaller deferrable items

Pick these up between phases or fold into one of the above.

- **Silent dividend import** — one-click button in the dividends card
  that takes the auto-suggest list and POSTs them all in one go
  (offered earlier; never wired up)
- **Per-user WS filter** — currently the hub broadcasts every ticker to
  every client. Filter to the user's holdings + watchlist + currently
  open page. The 100 ms client coalesce buffer mitigates this for now
- **`.env.example` — Upstox v3, not v2** — comment still says "Upstox v2
  REST quotes"; the implementation is now v3 WebSocket
- **Migration `holdings.asset_type` CHECK** — still permits `'crypto'`
  even though no code path creates them. Tighten to `('stock','mf')`
  in a new additive migration
- **Migrate `/sectors` away from hardcoded `sectors.All`** — the right
  sidebar still uses `internal/sectors/data.go`'s curated map. The newer
  `/stocks/catalog?category=sector:…` resolves through `indices.Catalog`
  (NSE archives). Either point the sidebar at `/stocks/catalog` and
  retire `internal/sectors`, or rebuild that handler on top of indices.
- **Stable cursor for movers pagination** — currently movers are sorted
  in-memory and sliced by offset. Within one user session this is fine
  (sort doesn't shift much in 30 s) but a long browse + price churn can
  cause minor duplicates. A request-time snapshot ID would fix it.

---

## Recommended order

1. **J — Deploy & polish.** The CV-readiness gain is bigger than any
   feature add. Live URL + screenshots + video are what convert a
   recruiter glance into a click-through.
2. **F — Benchmark comparison.** Highest-value feature gap; every
   Indian user notices it's missing.
3. **H — Onboarding & empty states.** Once the live URL exists,
   first-run UX matters.
4. **I — WebSocket resilience.** Small, but the deployed version will
   notice it whenever the API restarts.
5. Then K / G / L / M based on what you want to talk about in interviews.
