# API Reference

All endpoints live under `/api/v1` and return JSON. The WebSocket endpoint
lives at `/ws` (JWT in query string).

**Base URL** — `http://localhost:8080` (dev) or whatever `VITE_API_URL`
points at in production.

**Auth** — `Authorization: Bearer <access-token>` on every endpoint except
the three auth ones, the public price endpoints, the public market /
sectors / fundamentals endpoints, and `/healthz`.

**Error shape** — all error responses have:

```json
{
  "code": "short_machine_readable_slug",
  "message": "human-readable sentence"
}
```

---

## Health

### `GET /healthz`

Public. Returns the server's wall-clock time for smoke-tests.

```json
{ "status": "ok", "time": "2026-04-26T10:45:12Z" }
```

---

## Auth

### `POST /api/v1/auth/register`

```json
{ "email": "a@b.co", "password": "strongpass", "displayName": "Alice" }
```

201 → `{ accessToken, refreshToken, user: { id, email, displayName } }`.
409 `email_taken` if the email already exists.

### `POST /api/v1/auth/login`

```json
{ "email": "a@b.co", "password": "strongpass" }
```

200 → same token envelope. 401 `invalid_credentials` on bad email or password.

### `POST /api/v1/auth/refresh`

```json
{ "refreshToken": "<jwt>" }
```

200 → new token envelope. 401 on invalid or expired refresh token.

### `GET /api/v1/me`

Returns the current user:

```json
{ "id": "uuid", "email": "a@b.co", "displayName": "Alice" }
```

---

## Portfolios & holdings

All auth-required.

### `GET /api/v1/portfolios`

```json
{ "items": [ { "id": "uuid", "userId": "uuid", "name": "…", "baseCcy": "INR", "createdAt": "…", "updatedAt": "…" } ] }
```

### `GET /api/v1/portfolios/:id/holdings`

Holdings enriched with live prices and computed P&L.

```json
{
  "items": [
    {
      "id": "uuid",
      "portfolioId": "uuid",
      "ticker": "RELIANCE",
      "assetType": "stock",
      "quantity": "10",
      "avgBuyPrice": "2450.00",
      "currentPrice": "2481.23",
      "currentValue": "24812.30",
      "invested": "24500.00",
      "pnl": "312.30",
      "pnlPercent": "1.27",
      "dayChangePct": "0.35",
      "updatedAt": "…"
    }
  ]
}
```

### `GET /api/v1/portfolios/:id/summary`

```json
{
  "portfolioId": "uuid",
  "invested": "50000.00",
  "currentValue": "55000.00",
  "pnl": "5000.00",
  "pnlPercent": "10.00",
  "dayChange": "350.12",
  "holdingCount": 7
}
```

---

## Transactions

### `POST /api/v1/transactions`

Execute a buy or sell. Returns 201 with the written `Transaction` row.

```json
{
  "portfolioId": "uuid",
  "ticker": "RELIANCE",
  "assetType": "stock",
  "side": "buy",
  "quantity": "1",
  "price": "2481.23",
  "fees": "5",
  "note": "optional"
}
```

422 `insufficient_quantity` on a sell > available. 422 `no_position` on a
sell against a ticker you don't hold. 403 if the portfolio isn't yours.

### `GET /api/v1/transactions?limit=N`

Lists user's transactions (default `limit=50`, max 500).

```json
{
  "items": [
    {
      "id": "uuid", "userId": "uuid", "portfolioId": "uuid",
      "ticker": "RELIANCE", "assetType": "stock",
      "side": "buy", "quantity": "1", "price": "2481.23",
      "totalAmount": "2486.23", "fees": "5", "note": null,
      "source": "manual", "sourceId": null,
      "executedAt": "…"
    }
  ]
}
```

### `GET /api/v1/transactions/:id`

Full detail with ledger entries and audit rows. Scoped to the owning user (404 on mismatch).

```json
{
  "transaction": { ... },
  "ledgerEntries": [
    { "id": 1, "account": "positions:RELIANCE", "direction": "debit", "amount": "2481.23", "currency": "INR", "createdAt": "…" },
    { "id": 2, "account": "cash", "direction": "credit", "amount": "2481.23", "currency": "INR", "createdAt": "…" }
  ],
  "auditEntries": [
    { "id": 42, "action": "transaction.create", "entityType": "transaction", "entityId": "uuid", "payload": {...}, "ip": null, "createdAt": "…" }
  ]
}
```

---

## P&L / XIRR

### `GET /api/v1/portfolios/:id/xirr`

```json
{ "rate": 0.1274, "flowCount": 8 }
```

When there aren't enough cashflows to converge (or rate > ±500%/yr):

```json
{ "rate": null, "flowCount": 2, "insufficient": true }
```

### `GET /api/v1/portfolios/:id/holdings/:ticker/xirr`

Same shape, scoped to one ticker.

---

## Prices

### `GET /api/v1/quotes?tickers=RELIANCE,TCS,…`

Public. Returns the latest cached quote per ticker (skips any that aren't cached).

```json
{
  "items": [
    { "ticker": "RELIANCE", "price": "2481.23", "prevClose": "2470.00", "changePct": "0.45", "updatedAt": "…" }
  ]
}
```

### `GET /api/v1/quotes/:ticker`

Single quote. 404 if nothing is cached for that ticker.

### `GET /api/v1/quotes/:ticker/history?limit=120`

Recent intraday ticks from the Redis ring buffer (oldest first).

```json
{
  "ticker": "RELIANCE",
  "items": [ { "ticker": "RELIANCE", "price": "2481.23", "prevClose": "…", "changePct": "…", "updatedAt": "…" } ]
}
```

### `GET /api/v1/quotes/:ticker/candles?range=1y`

Historical OHLC candles. `range` is one of `1d` · `1w` · `1m` · `3m` ·
`1y` · `5y` · `max`. Routes to mfapi.in for MF scheme tickers, Yahoo
Finance for everything else.

```json
{
  "ticker": "RELIANCE",
  "range": "1y",
  "items": [ { "time": 1704067200, "open": 2400, "high": 2450, "low": 2380, "close": 2420, "volume": 1234567 } ]
}
```

### `GET /api/v1/quotes/:ticker/fundamentals`

Public. Yahoo `quoteSummary` data, Redis-cached 24 h. Every metric is
optional — Yahoo doesn't return every field for every ticker.

```json
{
  "symbol": "RELIANCE",
  "marketCap": 1834000000000, "trailingPE": 24.5, "forwardPE": 22.1,
  "priceToBook": 2.18, "eps": 102.3, "enterpriseValue": 1900000000000,
  "fiftyTwoWeekHigh": 2856.0, "fiftyTwoWeekLow": 2220.0,
  "beta": 0.9, "averageVolume": 7200000,
  "dividendYield": 0.0042, "dividendRate": 10.5, "payoutRatio": 0.105,
  "profitMargins": 0.082, "returnOnEquity": 0.094, "debtToEquity": 0.42,
  "sector": "Energy", "industry": "Oil & Gas Refining & Marketing",
  "fullTimeEmployees": 347000, "description": "…", "website": "https://…",
  "nextEarningsDate": "2026-07-25T00:00:00Z",
  "exDividendDate":  "2026-08-15T00:00:00Z",
  "dividendPayDate": "2026-09-05T00:00:00Z",
  "financials":          [ { "year": 2025, "endDate": "…", "totalRevenue": 9_000_000_000_000, "grossProfit": null, "operatingIncome": …, "netIncome": …, "ebitda": … } ],
  "quarterlyFinancials": [ … ],
  "balanceSheets":          [ { "year": 2025, "endDate": "…", "totalAssets": …, "totalLiabilities": …, "stockholderEquity": …, "longTermDebt": …, "shortTermDebt": …, "cash": … } ],
  "quarterlyBalanceSheets": [ … ],
  "cashFlows":          [ { "year": 2025, "endDate": "…", "operatingCashFlow": …, "investingCashFlow": …, "financingCashFlow": …, "capEx": -…, "freeCashFlow": …, "dividendsPaid": -… } ],
  "quarterlyCashFlows": [ … ],
  "currency": "INR", "updatedAt": "…"
}
```

### `GET /api/v1/universe`

List of tickers covered by the mock feed.

### `GET /api/v1/search?q=reli&limit=10`

Local Upstox instrument index first, Yahoo fallback. Cached 5 min.

```json
{
  "items": [
    { "symbol": "RELIANCE", "name": "Reliance Industries Limited", "exchange": "NSE", "type": "EQUITY", "shortName": "RELIANCE" }
  ]
}
```

---

## Market

Public — no auth.

### `GET /api/v1/market/status`

Computed market state in IST.

```json
{
  "state": "open",                     // pre_open | open | post_close | closed | holiday
  "now": "2026-04-26T10:30:00Z",
  "openAt":  "2026-04-27T03:45:00Z",   // UTC; 09:15 IST next session
  "closeAt": "2026-04-27T10:00:00Z",   // UTC; 15:30 IST
  "holidayName": null
}
```

### `GET /api/v1/market/holidays`

NSE 2026 holiday calendar.

```json
{ "items": [ { "date": "2026-01-26T00:00:00Z", "name": "Republic Day" }, … ] }
```

### `GET /api/v1/market/indices`

Slug + label for every NSE index whose constituents successfully loaded.
Powers the movers filter dropdown.

```json
{ "items": [ { "slug": "nifty50", "label": "NIFTY 50" }, { "slug": "nifty100", "label": "NIFTY 100" }, … ] }
```

### `GET /api/v1/market/movers?limit=5&index=nifty50`

Top-N gainers + losers across the live cache. Indices and MFs filtered
out — equities only. `limit` 1-20, default 5. `index` optional — filter
the ranking pool to that NSE index's constituents.

```json
{
  "gainers": [ { "ticker": "RELIANCE", "price": "…", "prevClose": "…", "changePct": "1.84", "updatedAt": "…" }, … ],
  "losers":  [ { "ticker": "TATASTEEL", … "changePct": "-2.10", … }, … ],
  "total": 482
}
```

---

## Sectors

Public — no auth.

### `GET /api/v1/sectors`

11 NSE sectoral indices with their live index quote.

```json
{
  "items": [
    { "name": "Bank Nifty", "slug": "banknifty", "indexTicker": "BANKNIFTY", "quote": { … } },
    { "name": "Nifty IT",   "slug": "niftyit",   "indexTicker": "NIFTYIT",   "quote": { … } },
    …
  ]
}
```

### `GET /api/v1/sectors/:slug`

Sector index + every component's live quote. 404 if slug unknown.

```json
{
  "name": "Nifty IT", "slug": "niftyit", "indexTicker": "NIFTYIT",
  "indexQuote": { "ticker": "NIFTYIT", "price": "…", "changePct": "…", … },
  "components": [
    { "ticker": "TCS",  "quote": { "price": "…", "changePct": "…", … } },
    { "ticker": "INFY", "quote": { "price": "…", "changePct": "…", … } },
    …
  ]
}
```

---

## Alerts

### `GET /api/v1/alerts`

```json
{
  "items": [
    {
      "id": "uuid", "userId": "uuid",
      "ticker": "RELIANCE", "targetPrice": "2500.00", "direction": "above",
      "triggered": false, "triggeredAt": null, "createdAt": "…"
    }
  ]
}
```

### `POST /api/v1/alerts`

```json
{ "ticker": "RELIANCE", "targetPrice": "2500", "direction": "above" }
```

### `DELETE /api/v1/alerts/:id`

204 on success, 404 if not yours.

---

## SIPs

### `GET /api/v1/sips`

```json
{
  "items": [
    {
      "id": "uuid", "userId": "uuid", "portfolioId": "uuid",
      "ticker": "RELIANCE", "assetType": "stock",
      "amount": "1000", "frequency": "monthly",
      "nextRunAt": "…", "status": "active",
      "createdAt": "…", "updatedAt": "…"
    }
  ]
}
```

### `POST /api/v1/sips`

```json
{
  "portfolioId": "uuid",
  "ticker": "RELIANCE",
  "assetType": "stock",
  "amount": "1000",
  "frequency": "monthly",
  "firstRunAt": "2026-05-01T00:00:00Z"
}
```

### `PATCH /api/v1/sips/:id`

```json
{ "status": "paused" }
```

### `DELETE /api/v1/sips/:id`

Sets status to `cancelled`.

---

## Watchlists (multi-list)

### `GET /api/v1/watchlists`

Every list the user owns, with item counts. Auto-creates "My Watchlist"
on first call so the UI's star button is always functional.

```json
{
  "items": [
    {
      "id": "uuid", "name": "My Watchlist",
      "sortOrder": 1716000000, "itemCount": 7,
      "createdAt": "…", "updatedAt": "…"
    }
  ]
}
```

### `POST /api/v1/watchlists`

```json
{ "name": "Tech Bets" }
```

201 with the new list row.

### `PATCH /api/v1/watchlists/:id`

```json
{ "name": "Renamed list" }
```

204. 404 if not yours.

### `DELETE /api/v1/watchlists/:id`

Cascades items. 204. 404 if not yours.

### `GET /api/v1/watchlists/:id`

Items in the list, decorated with the latest cached quote.

```json
{
  "items": [
    {
      "id": "uuid", "watchlistId": "uuid",
      "ticker": "RELIANCE", "assetType": "stock", "sortOrder": 1716000000,
      "createdAt": "…",
      "quote": { "ticker": "RELIANCE", "price": "…", "changePct": "…", … }
    }
  ]
}
```

### `POST /api/v1/watchlists/:id/items`

```json
{ "ticker": "RELIANCE", "assetType": "stock" }
```

201 with the item row. Idempotent — re-adding the same ticker is a no-op.

### `DELETE /api/v1/watchlists/:id/items/:ticker?assetType=stock`

204.

### `GET /api/v1/watchlists/memberships/:ticker?assetType=stock`

Returns the IDs of every list this ticker is on. Powers the star
button's checkbox state in the popover.

```json
{ "watchlistIds": ["uuid", "uuid"] }
```

---

## Dividends

### `GET /api/v1/dividends?ticker=RELIANCE`

Most-recent first. `ticker` optional — omit to list all.

```json
{
  "items": [
    {
      "id": "uuid", "ticker": "RELIANCE", "assetType": "stock",
      "perShare": "10", "shares": "20", "amount": "200",
      "tds": "0", "netAmount": "200",
      "paymentDate": "2026-09-05T00:00:00Z",
      "exDate":      "2026-08-15T00:00:00Z",
      "note": null, "createdAt": "…"
    }
  ]
}
```

### `POST /api/v1/dividends`

Either `amount` or `perShare` may be omitted — the missing one is
derived from the other × `shares`.

```json
{
  "portfolioId": "uuid",                 // optional
  "ticker": "RELIANCE", "assetType": "stock",
  "perShare": "10", "shares": "20", "amount": "200",
  "tds": "0",
  "paymentDate": "2026-09-05",          // YYYY-MM-DD
  "exDate":      "2026-08-15",
  "note": "optional"
}
```

### `DELETE /api/v1/dividends/:id`

204.

### `GET /api/v1/dividends/summary`

Aggregates: YTD (calendar year), FY (Apr 1 IST), all-time, plus a top-25
by-ticker breakdown.

```json
{
  "yearToDate": "1280", "financialYear": "1280", "allTime": "9420",
  "count": 14,
  "fyLabel": "FY2026-27",
  "byTicker": [
    { "ticker": "ITC",  "total": "4200", "netTotal": "4200", "count": 6, "lastPaid": "…" },
    { "ticker": "ONGC", "total": "2800", "netTotal": "2800", "count": 4, "lastPaid": "…" }
  ]
}
```

### `GET /api/v1/dividends/suggested?ticker=RELIANCE`

Yahoo `events=div` history (last 5 years), filtered to ex-dates where
the user actually held shares. Each suggestion is decorated with
`alreadyLogged` (a fuzzy ±7-day match against existing entries).

```json
{
  "items": [
    {
      "ticker": "RELIANCE",
      "exDate": "2025-08-15T00:00:00Z",
      "perShare": "10.0",
      "sharesOnDate": "20",
      "amount": "200",
      "alreadyLogged": false
    }
  ]
}
```

---

## News

### `GET /api/v1/news/:ticker`

Per-ticker news with keyword sentiment. 503 `news_disabled` if
`NEWSAPI_KEY` isn't set, 503 `news_upstream` on provider failure.

```json
{
  "ticker": "RELIANCE",
  "items": [
    {
      "title": "…", "description": "…", "url": "https://…",
      "source": "Reuters", "publishedAt": "…",
      "sentiment": "positive", "score": 2
    }
  ]
}
```

---

## AI Insights

### `GET /api/v1/insights`

Cached-or-fresh AI review. 503 `insights_disabled` when `GEMINI_API_KEY`
isn't set, 502 `insights_upstream` on provider failure after retries + fallback.

```json
{
  "executiveSummary": "…",
  "healthScore": { "overall": 78, "label": "Good", "diversification": 65, "riskManagement": 72, "performance": 85, "discipline": 70 },
  "keyHighlights": {
    "topPerformer": { "ticker": "RELIANCE", "value": "+18.5%", "note": "…" },
    "topLaggard": { ... },
    "biggestPosition": { ... },
    "fastestMover": { ... }
  },
  "analysis": { "allocation": "…", "concentration": "…", "performance": "…", "discipline": "…" },
  "strengths": [ { "title": "…", "detail": "…" } ],
  "risks": [ { "title": "…", "detail": "…", "severity": "high" } ],
  "suggestions": [ { "title": "…", "detail": "…", "priority": "high", "category": "rebalance" } ],
  "nextSteps": [ "…", "…" ],
  "generatedAt": "…", "model": "gemini-2.5-flash", "cached": false,
  "input": { "holdings": 9, "transactions": 8, "sips": 0 }
}
```

### `POST /api/v1/insights/refresh`

Forces regeneration (bypasses the 30-min cache). Same response shape.

---

## Tax

### `GET /api/v1/tax/summary`

Full FIFO-matched tax report, all financial years. Indian post-Jul-2024
rates: 20% STCG, 12.5% LTCG with ₹1.25L per-FY exemption.

```json
{
  "generatedAt": "…",
  "currency": "INR",
  "years": [
    {
      "financialYear": "FY2024-25",
      "startDate": "2024-04-01T00:00:00Z",
      "endDate":   "2025-03-31T23:59:59Z",
      "stcgEquityGain": "…", "stcgEquityTax": "…",
      "ltcgEquityGain": "…", "ltcgExemptionUsed": "…", "ltcgTaxableGain": "…", "ltcgEquityTax": "…",
      "totalGain": "…", "totalTax": "…", "effectiveRate": "…",
      "realizations": [ { ...one row per FIFO slice... } ]
    }
  ],
  "unrealized": { "stcgEquityGain": "…", "ltcgEquityGain": "…", "totalGain": "…" },
  "rates": { "stcgEquityPct": "20", "ltcgEquityPct": "12.5", "ltcgExemption": "125000", "longTermHoldingDays": 365 }
}
```

---

## WebSocket

### `GET /ws?token=<access-token>`

Upgrades to a WebSocket. The token is a query-string param because
browsers can't send headers during WS upgrade.

On connect, the server sends a snapshot replay of every cached quote so
the client can paint immediately without waiting for the next tick.
After that it streams live events as they arrive.

The server sends JSON events wrapped in an envelope:

```json
{ "type": "price", "data": { "ticker": "RELIANCE", "price": "2481.23", "prevClose": "…", "changePct": "…", "updatedAt": "…" } }
```

```json
{ "type": "alert.triggered", "data": {
    "alertId": "uuid", "userId": "uuid",
    "ticker": "RELIANCE", "direction": "above",
    "targetPrice": "2500.00", "price": "2501.50",
    "triggeredAt": "…"
  }
}
```

- `price` events are broadcast to every connected client
- `alert.triggered` events only go to the owning user's sockets (`Hub.SendToUser`)

The server sends a ping every 30 s and closes the connection if it
doesn't get a pong within 70 s. Clients should reconnect with backoff
and handle missed events by calling `GET /api/v1/alerts` to reconcile.

The browser's `useLivePrices` hook coalesces price events in a 100 ms
buffer so the UI doesn't thrash with 500+ tickers ticking at once.

---

## Status / error codes used

| HTTP | `code` | When |
|---|---|---|
| 400 | `bad_request`, `bad_json`, `bad_ticker`, `bad_side`, `bad_qty`, `bad_price`, etc. | Malformed input |
| 401 | `unauthorized`, `invalid_credentials` | Missing/invalid token or wrong password |
| 403 | `forbidden` | Logged in but not authorized for this resource |
| 404 | `not_found` | Resource doesn't exist or isn't yours |
| 409 | `email_taken`, `conflict` | Uniqueness violation |
| 422 | `insufficient_quantity`, `no_position` | Semantically invalid trade |
| 429 | (handled upstream) | Upstream rate limit |
| 500 | `internal` | Unhandled; check server logs |
| 502 | `insights_upstream` | AI provider failed after retries |
| 503 | `news_disabled`, `insights_disabled` | Optional feature not configured on the server |
