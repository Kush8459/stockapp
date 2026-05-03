# Upstox setup

Switching the price feed from Yahoo (`PRICE_SOURCE=real`) to Upstox
(`PRICE_SOURCE=upstox`) gives you true real-time WebSocket ticks instead
of 30-second polling — but Upstox enforces a daily token refresh as a
SEBI/regulatory requirement.

This doc is the runbook for both the one-time setup and the daily
refresh ritual.

---

## When to switch

| Stay on `real` (Yahoo) | Switch to `upstox` |
|---|---|
| Portfolio-style learning | Active intraday / day trading |
| MFs + SIPs | Real-time chart "feel" matters |
| Don't want a daily ritual | OK with 30 sec/day of token refresh |

`real` is genuinely fine for 90% of paper-trading use cases. Switch only
when sub-second latency matters to you.

---

## One-time setup

### 1. Confirm Upstox app credentials

You should already have these from when you registered the app at
[account.upstox.com/developer/apps](https://account.upstox.com/developer/apps):

- **API key** — public, like `274d1755-e4ed-479a-b996-24687d2cce9a`
- **API secret** — private, like `o9egf8lzur`
- **Redirect URL** — must match what you registered. Stays as
  `http://localhost:8080/api/v1/integrations/upstox/callback` because
  the OAuth flow runs on your laptop, not on Fly

### 2. See what's already on Fly

```powershell
fly secrets list --app stockapp-api
fly secrets list --app stockapp-worker
```

Compare against the five Upstox-related secrets:

```
PRICE_SOURCE
UPSTOX_API_KEY
UPSTOX_API_SECRET
UPSTOX_ACCESS_TOKEN
UPSTOX_REDIRECT_URL
```

Only set what's missing or stale. Re-setting a secret to its existing
identical value is a no-op (Fly skips the redeploy).

### 3. Generate the first access token

```powershell
cd backend
go run ./cmd/upstox-login
```

This:

1. Spins up a tiny local HTTP listener on the redirect port
2. Opens your browser at the Upstox OAuth consent screen
3. You authorize → Upstox redirects to `localhost:8080/...callback`
4. The helper grabs the code, swaps it for an access token
5. Writes `UPSTOX_ACCESS_TOKEN=<token>` into your local `.env`

**Stop your local API server first** — the helper needs the redirect
port (`:8080`) free for the callback.

Copy the new token value out of `.env`.

### 4. Push to Fly (both apps)

The worker is the one that streams ticks; the API needs the secrets too
because they share the config struct that requires them at startup.

```powershell
# API
fly secrets set --app stockapp-api `
  PRICE_SOURCE=upstox `
  UPSTOX_API_KEY=<your-key> `
  UPSTOX_API_SECRET=<your-secret> `
  UPSTOX_ACCESS_TOKEN='<token-from-step-3>' `
  UPSTOX_REDIRECT_URL=http://localhost:8080/api/v1/integrations/upstox/callback

# Worker
fly secrets set --app stockapp-worker `
  PRICE_SOURCE=upstox `
  UPSTOX_API_KEY=<your-key> `
  UPSTOX_API_SECRET=<your-secret> `
  UPSTOX_ACCESS_TOKEN='<token-from-step-3>' `
  UPSTOX_REDIRECT_URL=http://localhost:8080/api/v1/integrations/upstox/callback
```

Each `fly secrets set` triggers an automatic redeploy (~30 s) of that
app.

### 5. Verify

```powershell
fly logs --app stockapp-worker
```

You should see lines like:

```
upstox subscribed instruments=...
tick received ticker=RELIANCE price=2 503.45
```

repeating every few seconds during market hours. If you see
`error: invalid_token` or `401`, the token is wrong/expired — go back to
step 3.

In the browser, the StockHero "Offline" badge on a stock detail page
should switch to a green "Live" indicator within a minute.

---

## Daily refresh

Upstox tokens expire **daily at ~3:30 AM IST** (regulatory). After
expiration, all WS connections drop and the app can't fetch new prices
until a fresh token is set.

### Best window to refresh

| When | Coverage |
|---|---|
| 🟢 **3:30 AM – 9:15 AM IST** | Best — full trading day with no scramble |
| 🟡 **During market hours (9:15 AM – 3:30 PM)** | Works for the rest of the day, but you'll have stale prices until you refresh |
| 🔴 **After 3:30 PM** | Wasted — token will expire at next 3:30 AM, before market reopens |

Aim for **between 6 AM and 9 AM IST**.

### Refresh steps

```powershell
cd backend

# 1. Generate fresh token (writes to local .env)
go run ./cmd/upstox-login

# 2. Pull the new value out of .env (PowerShell)
$tok = (Select-String "^UPSTOX_ACCESS_TOKEN=" .env).Line.Split('=', 2)[1]

# 3. Push to both Fly apps
fly secrets set UPSTOX_ACCESS_TOKEN=$tok --app stockapp-api
fly secrets set UPSTOX_ACCESS_TOKEN=$tok --app stockapp-worker
```

About 30 seconds end-to-end once you're logged into Upstox in your
browser. Each `fly secrets set` triggers a redeploy of just that app.

### Forgot to refresh?

Nothing breaks permanently:

- Live WS prices stop streaming for that session
- Frontend "Offline" badges appear (StockHero, MutualFundDetail)
- Holdings, transactions, charts all still work using the last cached
  prices
- The `real` (Yahoo) source is a configurable fallback if you want it

So missing a day = degraded experience for one trading session, not a
broken app. Refresh whenever you next remember.

---

## Switching back to Yahoo

If the daily ritual gets old:

```powershell
fly secrets set PRICE_SOURCE=real --app stockapp-api
fly secrets set PRICE_SOURCE=real --app stockapp-worker
```

The Upstox secrets stay set on Fly but go unused. Switch back any time
by setting `PRICE_SOURCE=upstox` and refreshing the access token.

A common pattern: **`upstox` locally** for fast ticks during dev,
**`real` on Fly** to skip the daily refresh on prod. Set
`PRICE_SOURCE=upstox` in your local `.env`, leave Fly on `real`.

---

## Troubleshooting

### `error: invalid_token` in worker logs

Token expired or copied wrong. Re-run `go run ./cmd/upstox-login` and
push to Fly again.

### `address already in use` when running `upstox-login`

Your local API server is running on `:8080`. Stop it (Ctrl+C in the
`make be-run` terminal) before running the login helper, then start the
server again afterwards.

### Tokens don't auto-redeploy on Fly

`fly secrets set` only triggers a redeploy when the value changes. If
you accidentally set the same token twice, the second call is a no-op —
that's expected, not a bug.

### Worker stops streaming after a few minutes

Could be a network hiccup or upstream throttle. The worker reconnects
automatically — check `fly logs --app stockapp-worker` for `reconnecting…`
lines. If it never recovers, restart the machine:

```powershell
fly machine restart <machine-id> --app stockapp-worker
```

### Switched to Upstox but charts still show stale prices

Hard-refresh the browser (`Ctrl+Shift+R`) — the WebSocket reconnects
automatically but the React Query cache may still hold the snapshot
from before the switch.
