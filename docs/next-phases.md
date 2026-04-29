# Next phases

What's left to build, ordered roughly by value-per-effort. Each phase is
independent — pick whichever matters most when you sit down.

> The original product spec lives in [`roadmap.md`](roadmap.md). That's
> the historical "what we set out to build". This doc is the forward-looking
> "what's still to do".

---

## Where we are

Phases 1–3 of the original roadmap are done. Phase 4 (XIRR display, CSV
export, allocation analysis, audit log) is done. Phases F (benchmark
comparison), G (multi-portfolio + goals), H (onboarding card — partial),
I (WebSocket resilience), L (mobile responsiveness), M (paper-trading mode
— now end-to-end via the wallet), and K (observability) are all done.

Beyond the original roadmap we've also shipped: tax P&L, dividend tracking
with auto-suggest, fundamentals + financials (Yahoo `quoteSummary`),
market-context bar, 11-sector heatmap, NIFTY-filterable top movers, and
dynamic Upstox subscribe across ~9 000 NSE equities.

**Recent additions** (since the last roadmap revision):

- **Wallet system** — every user has a real INR cash account. Buys debit
  the wallet (price × qty + brokerage + statutory + GST), sells credit
  net proceeds, charges modelled after Zerodha/Groww direct equity. Seed
  ₹1,00,000 for every existing + new user. Deposit/withdraw via UPI / net
  banking / debit card (mocked, no real PSP). SIPs auto-pause when the
  wallet runs dry, with a `pause_reason` badge in the UI.
- **Multi-portfolio + goals (Phase G)** — portfolio switcher in the topbar,
  CRUD with audit-trail-safe delete (refuses to drop a portfolio that has
  transactions). Goals tab: target corpus + deadline, progress bar, and
  an "on track" verdict that projects the user's current XIRR forward
  to the goal date.
- **Light/dark theme toggle** — CSS variables, persisted in localStorage,
  pre-paint inline script avoids the dark→light flash. Sun/moon icon in
  the sidebar header.
- **WebSocket resilience (Phase I)** — exponential backoff (1s → 30s),
  banner when down >5s, alerts/holdings/summary refetched on reconnect
  to reconcile missed events.
- **Benchmark comparison (Phase F)** — backend `GET /portfolios/{id}/timeseries`
  replays transactions day-by-day against EOD candles to produce a portfolio
  series; frontend overlays it against NIFTY 50 / SENSEX / BANK NIFTY /
  NIFTY IT / NIFTY MIDCAP, normalized to 100 at start. **Alpha vs benchmark**
  pill answers "did I beat the index?" at a glance.
- **Mobile responsive (Phase L)** — sidebar collapses to a slide-out drawer
  under `md`; tables on Holdings + Transactions render as stacked cards on
  small screens; profile sidebar tabs become a horizontal scroll strip.
- **Onboarding card** for new users — three-step welcome (fund wallet →
  browse → first trade) with progress checkmarks; auto-graduates once the
  user has any transaction.
- **Observability (Phase K)** — Prometheus `/metrics` endpoint exposing
  trade rate / latency / failures by reason, wallet movements by kind,
  WS connections + fan-out, SIP outcomes, API latency by route. Grafana
  dashboard auto-provisioned via `make obs-up`.
- **UI refreshes** — Holdings hero, Dashboard hero (mood-ring gradient +
  diverging movers race bars), Stock-detail Bloomberg-style ribbon
  (intraday sparkline backdrop, day/52w range bars, key stats), MF
  returns heatmap.
- **Removed Gemini AI insights** — feature dropped; backend `internal/insights`
  package and frontend `AiInsights` component deleted.

See [`features.md`](features.md) for the full inventory of what's shipped.

---

## Still pending

### Phase J — Production polish & deploy

**Effort:** ~2–3 days · **Value:** highest · **Risk:** low

The product is feature-rich; what's missing is the thing that makes
someone reading the CV actually click through.

- Pick a host (Hetzner VPS recommended — cheapest + best CV story; see
  [`deployment.md`](deployment.md))
- Live URL with HTTPS via Caddy
- Add `LICENSE` (MIT)
- README screenshots — Dashboard hero, Holdings, Stock-detail ribbon,
  MF heatmap, Watchlist, Tax
- 90-second demo video / GIF showing live ticks + buy flow + SIP
  setup + benchmark overlay
- UptimeRobot on `/healthz` (free)
- Tighten security: rate-limit `/auth/login` and `/auth/register`,
  HSTS header, stricter CSP
- Update repo description + topics on GitHub

---

### Tests on money paths

**Effort:** ~1–2 days · **Value:** very high (fintech interview signal) · **Risk:** low

Every fintech interviewer asks "how do you prevent money from disappearing?"
You walk in with the answer.

- Unit tests for `wallet.ComputeCharges`, `wallet.NetAmount`, `wallet.ApplyTradeInTx`
- Unit tests for `portfolio.timeseries.applyTxn` (replay invariants)
- Unit tests for the XIRR Newton-Raphson solver
- Integration test for `transaction.Execute` against a real Postgres via
  `testcontainers-go` (boot postgres in CI, run migrations, drive a sequence
  of buys/sells, assert holdings + ledger sum to zero)
- Property-based test for the wallet conservation invariant: for any random
  sequence of deposits/withdrawals/buys/sells, assert
  `wallet_balance + Σ(holdings × avg_price) ≈ Σ(deposits − withdrawals)
  − Σ(charges)` to within rounding

---

### Idempotency keys on `POST /transactions`

**Effort:** ~half day · **Value:** high (production rigor) · **Risk:** low

`Idempotency-Key` header → Redis-backed `(user_id, key)` → cached response
for 24h. Stripe-style; prevents double-spend on user double-clicks or
client retries on flaky networks.

---

### Order types: limit orders

**Effort:** ~1 day · **Value:** high (domain depth) · **Risk:** medium

Market-order-only is "toy" — add `LIMIT` orders that sit in a small
in-process book and fill when the WS price crosses. Massive fintech
signal that you understand microstructure.

- New `orders` table with `type ('market'|'limit')`, `limit_price`, `status`
- Order matcher loop reading the price stream
- Auto-cancel after market close
- Frontend: order-type toggle in the trade dialog, "open orders" tab

---

### Architecture Decision Records

**Effort:** ~half day · **Value:** medium (interview signal) · **Risk:** zero

`docs/adr/`, ~3–5 short markdown files (~200 words each):
- `001-why-serializable-isolation.md`
- `002-why-modular-monolith.md`
- `003-why-shopspring-decimal.md`
- `004-why-jwt-over-sessions.md`
- `005-why-postgres-over-redis-streams.md`

Lets you walk into the interview saying "before you ask, here are the
trade-offs I documented."

---

### CI pipeline

**Effort:** ~2 hours · **Value:** medium · **Risk:** zero

`.github/workflows/ci.yml`:
- `go vet ./...` + `go build ./...` + `go test ./...`
- Frontend: `npm ci`, `tsc --noEmit`, `npm run build`
- Run on every PR + push to `main`

---

### Slippage + execution simulation

**Effort:** ~half day · **Value:** medium (domain depth) · **Risk:** low

Real trades don't fill at the last quote. Inject randomized slippage on
market orders proportional to size:
- Market buy of < ₹10k: ±0.05%
- ₹10k–1L: ±0.10%
- > 1L: scales with √(qty / avg-volume)

The `quoted price ≠ executed price` reality shipping in the demo
separates this from a textbook project. Display both on the order
detail page.

---

### Phase H finish — better empty states

**Effort:** ~1 day · **Value:** medium · **Risk:** low

The onboarding card covers the dashboard, but per-page empty states
need work:
- **Alerts** — "Set one to track RELIANCE crossing ₹2 500" with a working CTA
- **Watchlist** — explanatory state when no list exists yet
- **Tax** — "no taxable events this FY" with a link to redeem flow
- Tooltips on first hover for XIRR / day-change / FY-tax columns

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
2. **Tests on money paths.** Pure fintech-interview signal. A handful
   of well-chosen unit tests + one integration test transforms the
   project narrative.
3. **Idempotency + ADRs + CI.** Three small wins that tell hiring
   managers "this person ships production-grade".
4. **Order types** — bigger feature, but the strongest "I understand
   markets" signal of anything left on the list.
