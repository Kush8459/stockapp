# Features

Every shipped feature, what it does, which backend package it lives in,
and which frontend page / component surfaces it.

> For API shapes, see [`api.md`](api.md).
> For design rationale, see [`architecture.md`](architecture.md).

---

## Authentication

| What | Where |
|---|---|
| Register with email + password (bcrypt cost 10) | `internal/user` · `/login`, `/register` pages |
| JWT access + refresh tokens (HS256) | `internal/auth` |
| Transparent refresh on 401 via axios interceptor | `frontend/src/lib/api.ts` |
| Auth middleware on every protected route | `internal/auth/context.go` |
| Session persists across refresh (Zustand + `persist`) | `store/auth.ts` |

Default TTLs: **15 min** access, **30 days** refresh.

---

## Portfolios & holdings

| What | Where |
|---|---|
| One portfolio auto-created at signup | `user.Handler.register` |
| List holdings with live-price-enriched P&L | `internal/portfolio.Service.EnrichedHoldings` |
| Dashboard summary (invested / value / P&L / day change) | `portfolio.Service.Summary` |
| Holdings page with per-ticker XIRR + allocation donut | `pages/Holdings.tsx` |
| Asset-type breakdown (stock · MF) | Tailwind-coloured chips per type |

---

## Transactions (double-entry)

| What | Where |
|---|---|
| Buy / Sell with `SERIALIZABLE` + `SELECT FOR UPDATE` | `internal/transaction.Service.Execute` |
| Weighted-average cost basis on buy | same |
| Reject sells larger than quantity (HTTP 422) | same |
| Writes `transactions` + `ledger_entries` pair(s) + `audit_log` in one DB tx | same |
| Append-only `audit_log` (Postgres triggers block UPDATE/DELETE) | `migrations/000001_init.up.sql` |
| `source` column (`manual` / `sip` / `alert` / `rebalance`) + `source_id` FK | `migrations/000002_add_transaction_source.up.sql` |
| Transactions list page with filters + CSV export | `pages/Transactions.tsx` |
| Transaction detail page showing every field + ledger rows + audit breadcrumb | `pages/TransactionDetail.tsx` |
| Ledger-balance verification chip ("balanced" / "imbalanced") | `TransactionDetail.LedgerCard` |

---

## Trade dialog

| What | Where |
|---|---|
| Position context panel (qty / avg / market / P&L / available) | `components/TradeDialog.tsx` |
| `Max` button for sell | same |
| Live price input that tracks WebSocket until user types, `Use live` button to reset | same |
| Inline validation (sell > available) | same |
| Success toast with executed price + total | same |
| Optional note field (200 chars) stored on the transaction | same |

---

## Live prices

### Sources (`PRICE_SOURCE` env var)

| Value | Provider | Coverage | Auth |
|---|---|---|---|
| `mock` (default) | in-process random walk | MockUniverse tickers | none |
| `real` | Yahoo Finance + mfapi.in | NSE stocks + Indian MFs | none |
| `upstox` | Upstox v3 WebSocket (live tick stream) + mfapi.in for MFs + Yahoo gap-fill | ~9 000 NSE equities + 4 broad indices + 11 sectoral indices + Indian MFs | Daily access token |
| `polygon` | stubbed for future use | — | POLYGON_API_KEY |

### Pipeline (Upstox path)

1. `cmd/price-worker` blocks startup on two universe loaders (Upstox
   instruments CSV + NSE index constituents) with a 30 s timeout.
2. Calls `/v3/feed/market-data-feed/authorize` to exchange the bearer
   token for a one-time signed `wss://` URL.
3. Opens the WebSocket and subscribes to MockUniverse stocks + every
   NIFTY 500 ticker + every active holding / SIP / watchlist ticker
   (plus the indices). The hand-rolled protobuf wire decoder reads
   `feeds[<key>].ltpc` from the binary frames.
4. A 60 s refresh goroutine re-runs the ticker discovery query. New buys
   automatically join the WS subscription within a minute (incremental
   sub / unsub — no full reconnect).
5. Initial snapshot uses Upstox v2 batched REST (`/market-quote/quotes`,
   100 keys per call), with Yahoo gap-fill for any tickers Upstox missed
   and for the indices Upstox returns `0` for off-hours.
6. Every tick writes to Redis (`price:<TICKER>`, 2 min TTL), appends to
   the per-ticker ring buffer (`price:hist:<TICKER>`, last 240 ticks),
   and publishes on `prices:stream`.
7. The API server's `price.Hub` subscribes once per process and fans out
   to WebSocket clients. On connect each client gets a snapshot replay
   so the UI never paints `₹0` while waiting for the next tick.
8. Browser `useLivePrices` coalesces ticks in a 100 ms buffer so the UI
   doesn't thrash with 500+ stocks ticking at once.

### Real path (no Upstox token)

When `PRICE_SOURCE=real` (or `upstox` with empty token), NSE equities
poll Yahoo Finance v8 every 30 s and mutual funds poll mfapi.in every
30 min. Same Redis + WebSocket fan-out downstream.

### Historical (candles)

`GET /api/v1/quotes/:ticker/candles?range=1d|1w|1m|3m|1y|5y|max` — routes to
mfapi.in for MF tickers and to Yahoo `v8/finance/chart` for everything else.
Redis-cached per (ticker, range) with TTLs from 2 min (1D) to 24 h (MAX).
Tries multiple Yahoo symbol candidates (`.NS` → bare → `.BO`) so any
searched ticker resolves.

---

## XIRR

- Newton–Raphson with bisection fallback (`internal/pnl/xirr.go`)
- Portfolio-level: reads every transaction + terminal mark-to-market value
- Per-holding: same math scoped to one ticker
- Clamp at ±500%/yr to avoid annualizing tiny timespans
- Unit tests validate known cases (10%/yr, two-contribution portfolio)

Displayed:
- Dashboard hero card (portfolio XIRR)
- Holdings table (per-ticker XIRR column via `useQueries` parallel fetch)
- Stock detail page (per-holding XIRR)

---

## SIPs (Systematic Investment Plans)

| What | Where |
|---|---|
| Create / pause / resume / cancel | `internal/sip.Handler` · `pages/Sips.tsx` |
| Enhanced form: ticker combobox (from `/universe`), quick-pick amounts, units-per-run preview, next-3-runs list, 15-year projection chart with return slider | `components/SipForm.tsx` |
| Cron goroutine in the API process, polls every 60 s | `internal/sip.Scheduler` |
| `SELECT FOR UPDATE SKIP LOCKED` claim — safe under parallel schedulers | `internal/sip.Repo.ClaimDue` |
| SIP executions tagged `source="sip"` + `source_id=plan.id` on the transaction | `sip.Scheduler.execute` |
| Live countdown chip on each row, turns green when running | `components/Countdown.tsx` |
| Expandable rows with per-SIP projection and gain breakdown | `pages/Sips.tsx` |
| Status filter tabs with per-tab counts | same |

---

## Price alerts

| What | Where |
|---|---|
| Create above/below threshold alerts per ticker | `internal/alert.Handler` · `components/AlertForm.tsx` |
| Trigger engine subscribes to `prices:stream` | `internal/alert.Engine` |
| Atomic `MarkTriggered` (`UPDATE ... WHERE NOT triggered`) — only one tick wins the race | `alert.Repo.MarkTriggered` |
| Writes `alert.triggered` row to `audit_log` | `alert.Engine.fire` |
| User-scoped WebSocket delivery (`Hub.SendToUser`) | `internal/price/ws.go` |
| Browser receives `alert.triggered` event, shows toast, saves to in-memory event store | `hooks/useLivePrices` · `store/alertEvents.ts` |
| Alerts page with active / triggered separation | `pages/Alerts.tsx` |
| Dedup of duplicate toasts across connections (StrictMode / multi-tab) | module-level `seenAlerts` map with 10-min TTL |

---

## Watchlists (multi-list)

| What | Where |
|---|---|
| N named lists per user; default "My Watchlist" auto-created on first use | `internal/watchlist.Repo.EnsureDefaultList` |
| List CRUD (`/watchlists` GET/POST + `/watchlists/{id}` PATCH/DELETE) | `internal/watchlist.Handler` |
| Items live in their own table; one ticker can be on any subset of lists | `migrations/000003_watchlist.up.sql` + `000004_watchlists.up.sql` |
| Star button on stock-detail with popover showing every list + checkboxes for membership | `components/WatchlistPopover.tsx` |
| Memberships endpoint (`/watchlists/memberships/{ticker}`) powers the star's checked-state | `Repo.MembershipsForTicker` |
| `/watchlist` page shows every list with live-priced rows; tabs to switch between lists | `pages/Watchlist.tsx` |
| Worker discovery — `SELECT DISTINCT ticker FROM watchlist` joins the dynamic Upstox subscribe set | `cmd/price-worker/main.go` |

---

## Dividends

| What | Where |
|---|---|
| Per-receipt log with gross amount, TDS, generated `net_amount`, payment + ex-dates | `migrations/000005_dividends.up.sql` |
| CRUD endpoints (`/dividends`) | `internal/dividend.Handler` |
| Summary endpoint with YTD, FY (Apr 1 IST), all-time totals + per-ticker top-25 | `dividend.Repo.Summary` |
| Auto-suggest endpoint (`/dividends/suggested?ticker=…`) — pulls Yahoo `events=div` history, decorates each with the user's shares-on-ex-date and an `alreadyLogged` flag (±7-day fuzzy match against existing entries) | `dividend.Handler.suggested` + `price.DividendsYahoo` |
| Stock-detail "Dividends received" stat (sums payments while user held position) | `pages/StockDetail.tsx` |
| `EventsCard` surfaces upcoming ex-dividend / pay date from the fundamentals payload | `components/EventsCard.tsx` |

---

## Fundamentals & financials

Yahoo's `quoteSummary` endpoint with crumb-based auth (separate session
manager refreshes the crumb every 30 min). 11 modules requested in one
call: `summaryDetail`, `defaultKeyStatistics`, `summaryProfile`,
`financialData`, `calendarEvents`, `incomeStatementHistory(+Quarterly)`,
`balanceSheetHistory(+Quarterly)`, `cashflowStatementHistory(+Quarterly)`.

| What | Where |
|---|---|
| Cache per ticker, 24 h TTL, key prefix `fundamentals:v2:` | `internal/fundamentals.Service.Get` |
| Yahoo crumb dance (cookie via `fc.yahoo.com` → `getcrumb` → reuse) | `fundamentals/session.go` |
| Valuation card: market cap, P/E, P/B, EPS, EV, dividend yield/rate, payout ratio | `components/FundamentalsCard.tsx` |
| Profitability strip: profit margins, ROE, debt/equity | same |
| 52-week range bar with current-price marker | same |
| About card: sector, industry, employees, website, description | `components/AboutCard.tsx` |
| Events card: next earnings date, ex-dividend, pay date | `components/EventsCard.tsx` |
| Financials card with Income / Balance Sheet / Cash Flow tabs, Yearly ↔ Quarterly toggle, multi-select chip metrics, color-coded grouped bars (Recharts) | `components/FinancialsCard.tsx` |
| Free cash flow computed as `OCF + CapEx` (CapEx is negative in Yahoo's payload) | `fundamentals.mapCashFlow` |
| Empty-state filtering — only metrics with at least one non-zero value across visible periods are selectable, so India-style "no gross profit reported" doesn't show a flat line | `FinancialsCard.availableMetrics` |
| Indian-format Y-axis labels: ₹k → ₹L (lakh) → ₹Cr (crore) → ₹LCr (lakh-crore, ₹1 trillion) — drops decimals once the integer part has 4+ digits | `lib/utils.formatCompact` |

---

## Market context

The top bar (above every authenticated page) shows the live broad-market
ticker plus a trading-status badge.

| What | Where |
|---|---|
| Market-status badge (Pre-open / Open / Post-close / Closed / Holiday) computed in IST | `internal/market.CurrentStatus` · `components/MarketStatusBar.tsx` |
| NSE 2026 holiday calendar (date-certain holidays included; lunar holidays best-effort) | `internal/market/calendar.go` |
| Live ticker strip — NIFTY 50, SENSEX, Bank Nifty, NIFTY IT | `components/MarketContextBar.tsx` |
| `/market/status`, `/market/holidays`, `/market/indices`, `/market/movers` endpoints | `internal/market.Handler` |
| Calendar / status unit tests | `internal/market/calendar_test.go` |

---

## Sectoral heatmap

A right sidebar (always visible on desktop) showing live quotes for the
11 NSE sectoral indices.

| What | Where |
|---|---|
| `/sectors` lists every sector with its index quote | `internal/sectors.Handler.list` |
| `/sectors/{slug}` returns the index plus every component's live quote | `Handler.detail` |
| `pages/SectorDetail.tsx` — sortable component table with live flashes | route `/sector/:slug` |
| Sidebar (`SectorSidebar`) renders 11 sectors, each clickable into the detail page | `components/SectorSidebar.tsx` |
| Components mapped per sector in `internal/sectors/data.go` (currently hardcoded) | same |

---

## Top movers

| What | Where |
|---|---|
| `/market/movers?index=&limit=` returns top-N gainers + losers across the live cache | `internal/market.Handler.movers` |
| Index-aware filter — pool restricted to NIFTY 50 / 100 / Midcap 100 / 500 (or All) via `indices.IsInIndex` | same |
| Sign-aware filter — gainers must have `changePct > 0`, losers `< 0` (so off-hours zero-change tickers don't appear in either bucket) | same |
| Filters out indices and MFs — equities only | `isStockTicker` |
| Dashboard "Movers" card with the index dropdown | `components/MarketMovers.tsx` |

---

## Indices (NSE constituents)

| What | Where |
|---|---|
| At-startup load from NSE archive CSVs: NIFTY 50, Next 50, 100, Midcap 100, 500 | `internal/indices.LoadAll` |
| Hardcoded `FallbackNIFTY50` keeps the universe usable when the archive fetch fails | `indices/indices.go` |
| `IsInIndex(ticker, slug)` — used by the movers filter | same |
| `AllTickers()` — every NSE-listed equity across every loaded index, deduplicated; the worker uses this to seed the Upstox WS subscribe set | same |
| `Catalog` + `Index` types power the `/market/indices` dropdown payload | same |

---

## Global search

| What | Where |
|---|---|
| `GET /api/v1/search?q=…` | `internal/price.Search` |
| Local Upstox instrument index (~9 000 NSE equities) loaded at API+worker startup; matched with token-aware ranking (exact symbol → prefix → contains) | `internal/price.LoadUpstoxInstruments` + `SearchInstruments` |
| Yahoo Finance fallback when the local index has zero hits | `price.Search` |
| Redis-cached per query for 5 min | same |
| Sticky `<SearchBar>` in the app shell, visible on every page | `components/SearchBar.tsx` |
| Debounced input (300 ms), 2-char minimum | `hooks/useDebounce` + `hooks/useSearch` |
| `Cmd/Ctrl+K` focuses the input from anywhere | same |
| Keyboard nav (↑ ↓ Enter Esc) | same |
| Results route to `/stock/<ticker>` | same |

---

## Stock detail page

The page is laid out as discrete cards in this order: header → live chart
→ position + trade → events → fundamentals → financials → about → news.

| Section | Component |
|---|---|
| Header — ticker, name, last price, day change, market-status chip, **Watch** chip with multi-list popover | `pages/StockDetail.tsx` + `WatchlistPopover` |
| Live chart with range selector (1D / 1W / 1M / 3M / 1Y / 5Y / ALL); 1D seeds from Redis intraday ring buffer + appends WS ticks; pan/zoom disabled | `components/LiveChart.tsx` + `RangeSelector.tsx` |
| Position card — qty / avg / invested / value / P&L / XIRR / day change + holding period + dividends received + total return | `pages/StockDetail.tsx` |
| Trade card — Buy / Sell / Set alert | `components/TradeDialog.tsx` + `AlertForm.tsx` |
| Events card — next earnings, ex-dividend, pay date | `components/EventsCard.tsx` |
| Fundamentals card — valuation + profitability + 52-week range | `components/FundamentalsCard.tsx` |
| Financials card — Income / Balance Sheet / Cash Flow tabs, Yearly/Quarterly toggle, multi-metric chip selectors, Recharts grouped bars | `components/FinancialsCard.tsx` |
| About card — sector, industry, employees, website, description | `components/AboutCard.tsx` |
| News feed | `components/NewsFeed.tsx` |
| Fallback price from last candle for tickers outside the live stream | `pages/StockDetail.tsx` |
| TradingView attribution logo hidden (v5 `attributionLogo: false`) | `LiveChart.tsx` |

A `ScrollToTop` component in `App.tsx` ensures clicking a stock from
mid-dashboard lands at the top of the new page.

---

## News

| What | Where |
|---|---|
| `GET /api/v1/news/:ticker` — NewsAPI-backed | `internal/news.Service` |
| Ticker → query override map (`INFY → Infosys`) for better hits | same |
| Keyword-based sentiment scorer (positive / neutral / negative) | `internal/news/sentiment.go` |
| Redis cache 30 min per ticker (preserves free-tier quota) | same |
| Per-article card with source · sentiment chip · relative time · `ExternalLink` | `components/NewsFeed.tsx` |
| Distinct empty states (no news, provider offline, key missing) | same |

---

## AI Portfolio Review (Gemini)

| What | Where |
|---|---|
| Portfolio snapshot gathered as structured JSON | `internal/insights.Service.buildSnapshot` |
| Gemini 2.5 Flash with `responseSchema` for structured output | `internal/insights.gemini` |
| Automatic retry on 503/429/5xx + model fallback to 2.0 Flash | same |
| Rich output: exec summary, 4 sub-scores, 4 highlight cards, per-axis analysis, severity-rated risks, priority-ranked suggestions, next-steps | `internal/insights.Insight` |
| Redis cache 30 min per user | `insights.Service.Get` |
| Polished frontend card: animated health dial, 4 mini gauges, highlight tiles, bucket lists, gradient "Do this week" panel, disclaimer footer | `components/AiInsights.tsx` |

---

## Tax P&L

| What | Where |
|---|---|
| `GET /api/v1/tax/summary` — FIFO lot matching across all transactions | `internal/tax.Service.Report` |
| Holding-period classification (`≥365d` = long-term for equity / MF) | same |
| Indian post-Jul-2024 rates: 20% STCG / 12.5% LTCG with ₹1.25L exemption | `internal/tax/service.go` |
| Indian financial year bucketing (Apr 1 → Mar 31) | `financialYearOf` |
| "If you sold everything today" unrealized projection from live prices | `Service.computeUnrealized` |
| FY selector + 2 bucket cards (STCG / LTCG) + totals card + realization table | `pages/Tax.tsx` |
| CSV export per-FY | same, using shared `lib/csv.ts` |

---

## Dashboard

| What | Where |
|---|---|
| Live hero cards (value / invested / P&L / day change / XIRR) | `pages/Dashboard.tsx` · `components/PnLCard.tsx` |
| Allocation donut with active-slice highlight | `components/AllocationChart.tsx` |
| Top movers card with NIFTY index filter | `components/MarketMovers.tsx` |
| Holdings table with live flashes, sortable, quick actions | `components/HoldingsTable.tsx` |
| Buy/Sell modal wired to the row | `components/TradeDialog.tsx` |
| AI review card (if `GEMINI_API_KEY` set) | `components/AiInsights.tsx` |
| "Download statement" button → combined CSV (summary + holdings + all transactions) | `Dashboard.exportStatement` |

---

## Performance & deployability

- **WS coalescing** — `useLivePrices` flushes a 100 ms buffer per render so
  the UI stays smooth with 500+ tickers ticking
- **Snapshot replay on connect** — `price.Hub.Handler` ships every cached
  quote to a freshly connected client (in a goroutine with a 2 s
  per-message timeout) so dashboards never paint `₹0` while waiting
- **Bundle splitting** — Vite `manualChunks` for recharts / lightweight-charts / motion / radix / tanstack; `React.lazy()` on 9 of 10 authenticated routes
- **Multi-stage Dockerfiles** — distroless backend (~20 MB), nginx frontend (~40 MB)
- **`docker-compose.prod.yml`** — full stack with healthchecks + `restart: unless-stopped`
- **GitHub Actions CI** — go test/vet/build, tsc, vite build, Docker image smoke build (main only)
- **1-year immutable cache** on hashed frontend assets via nginx config
