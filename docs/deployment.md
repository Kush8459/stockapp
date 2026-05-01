# Deployment

This doc picks a hosting target, walks through each option, and lists the
exact environment variables the server needs in production.

## TL;DR — pick one

| Option | Best for | Cost (roughly) | Setup time |
|---|---|---|---|
| **Neon + Upstash + Fly.io + Vercel** | CV / portfolio — recommended | $5 trial credit (~2 mo free) then ~₹170/mo | 60 min — covered below as **Option B** |
| **Oracle Cloud Always Free** | If you can grab ARM capacity | **₹0 forever** (4 vCPU + 24 GB ARM) | 60+ min — capacity is hard to come by, see [`oracle-deploy.md`](oracle-deploy.md) |
| **Hetzner Cloud / DO / Vultr VPS** | Full control, single box | ~₹350–500/mo | 45 min |
| **Railway** | Button-click, no card needed initially | $5/mo credit, then ~₹400/mo | 15 min |
| **AWS / GCP** | If a team already lives there | ~₹2,000+/mo | A day |

**Recommended path in 2026: Option B — Neon + Upstash + Fly.io + Vercel.**
This is the split-stack, every layer on a free or near-free tier,
genuinely production-shaped: managed Postgres (Neon), managed Redis
(Upstash), Go API + worker on Fly with auto-stop, React SPA on Vercel's
global CDN. After the $5 Fly trial credit runs out (~2 months), it costs
about **₹170/mo** with the worker always-on; you can drop the worker for
**~₹0/mo** if live ticks aren't needed.

> **Note on Koyeb:** earlier versions of this doc recommended Koyeb. They
> killed the free tier in late 2024. Use Fly.io instead.

Oracle Free is *technically* free forever and fits this stack on one ARM
box, but Always-Free ARM capacity in Asia-Pacific regions has been
near-permanently exhausted since 2023. If you happen to grab capacity,
[`oracle-deploy.md`](oracle-deploy.md) is the guide. Otherwise skip it —
you'll burn more time fighting capacity errors than the savings justify.

Hetzner/DO/Vultr give you the same architecture as Option B on a single
box (~₹350/mo) — best resume material if "I deployed and operated a
self-managed VPS" reads better in your interviews.

Required across all options:
- A **Postgres 15+** instance
- A **Redis 7+** instance
- The **API server** (`backend/cmd/server`)
- The **price worker** (`backend/cmd/price-worker`)
- The **frontend** served as static files behind a web server

Optional integrations (leave the env var empty to disable):
- `NEWSAPI_KEY` — https://newsapi.org/
- `UPSTOX_API_KEY` / `UPSTOX_API_SECRET` / `UPSTOX_ACCESS_TOKEN` —
  official Upstox v3 live feed. The access token expires daily at
  ~3:30 AM IST; refresh with `cmd/upstox-login`. Without these, set
  `PRICE_SOURCE=real` to fall back to Yahoo + mfapi.in (no token, but
  ~30 s polling instead of live ticks).

---

## Environment variables

Required in every environment (production values shown):

```
APP_ENV=production
APP_HTTP_ADDR=:8080
APP_CORS_ORIGINS=https://your-frontend-domain.example

POSTGRES_HOST=<db-host>
POSTGRES_PORT=5432
POSTGRES_USER=stockapp
POSTGRES_PASSWORD=<strong-password>
POSTGRES_DB=stockapp
POSTGRES_SSLMODE=require      # use `disable` only on private networks

REDIS_ADDR=<redis-host>:6379
REDIS_PASSWORD=<if-any>
REDIS_DB=0

# 64+ hex chars — generate once with:  openssl rand -hex 32
JWT_SECRET=<at-least-32-chars>
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=720h

PRICE_SOURCE=upstox            # upstox (live WS) | real (Yahoo+mfapi poll) | mock (no outbound)
# Required when PRICE_SOURCE=upstox:
# UPSTOX_API_KEY=…
# UPSTOX_API_SECRET=…
# UPSTOX_ACCESS_TOKEN=…    # daily — refresh with `go run ./cmd/upstox-login`
```

Frontend build-time vars (baked into the bundle):

```
VITE_API_URL=https://api.your-domain.example
VITE_WS_URL=wss://api.your-domain.example
```

---

## Option A — Railway (easiest)

[railway.com](https://railway.com) gives you Postgres + Redis + container
apps in one dashboard. Free $5 of credit per month; after that ~$5/mo
for this stack.

1. **Push the repo to GitHub** (make sure `.env` is `.gitignore`d; it is).
2. On Railway:
   - New project → **Deploy from GitHub repo** → select this repo
3. **Add Postgres** → New → Database → PostgreSQL. Note the `DATABASE_URL`.
4. **Add Redis** → New → Database → Redis.
5. **Deploy the API**:
   - New → GitHub Repo → pick the same repo
   - Root directory: `backend`
   - Railway auto-detects the Dockerfile. Good.
   - Env vars (Variables tab): copy everything from the block above,
     using the Railway-provided Postgres/Redis private URLs.
   - In **Settings → Networking → Public Networking** enable a public domain.
   - In **Settings → Deploy → Build Args** leave empty (API doesn't need any).
6. **Deploy the worker**:
   - Same repo again, but set **Start command** to `/app` with
     `Dockerfile > Build Args > TARGET=price-worker`.
   - Same env vars as the API.
   - No public domain needed.
7. **Deploy the frontend**:
   - Same repo, root `frontend`. Set build args:
     - `VITE_API_URL=https://<your-api-service>.up.railway.app`
     - `VITE_WS_URL=wss://<your-api-service>.up.railway.app`
   - Public domain in Networking.
8. **Run migrations once** — from the Railway CLI, or from a one-off shell:
   ```bash
   railway run --service <api-service> migrate -path /migrations \
     -database "$POSTGRES_URL?sslmode=require" up
   ```
   Easiest alternative: run migrations from your laptop against the Railway
   Postgres public URL:
   ```bash
   docker run --rm -v $(pwd)/backend/migrations:/migrations migrate/migrate:v4.17.1 \
     -path /migrations -database "postgres://USER:PASS@HOST:PORT/stockapp?sslmode=require" up
   ```
9. **Update `APP_CORS_ORIGINS`** on the API service to the frontend's
   public URL, redeploy.
10. **Seed** if you want the demo account — one-off shell in the API:
    ```
    /app seed     # or deploy the seed binary the same way
    ```

Total time: ~15 minutes.

---

## Option B — Neon + Upstash + Fly.io + Vercel (recommended)

The actual working stack as of 2026. Every layer on a free or
near-free tier, all production-shaped, no docker-compose to babysit:

| Layer | Provider | Free tier |
|---|---|---|
| Postgres | **Neon** | 3 GB, no expiry, branching, pooler included |
| Redis | **Upstash** | 10 K commands/day on Regional, TLS-only |
| Go API + price-worker | **Fly.io** | $5 trial credit, then ~₹170/mo with worker |
| React frontend | **Vercel** | Unlimited static + global CDN, free |

The repo ships with the two Fly configs already in `backend/`:
`fly.api.toml` (auto-stop public web service) and `fly.worker.toml`
(singleton background daemon). And `frontend/vercel.json` adds the SPA
fallback so refresh on a deep route doesn't 404.

### 1. Provision Postgres on Neon

1. [console.neon.tech](https://console.neon.tech) → **New Project** →
   region nearest you (Singapore for India), Postgres 16, default
   `neondb` database.
2. **Connection Details** → copy *both* connection strings:
   - **Direct** (without `-pooler` in hostname) — for migrations only
   - **Pooled** (with `-pooler`) — for the running app
3. Run migrations once from your laptop using the **direct** URL:
   ```bash
   migrate -path backend/migrations -database "DIRECT_NEON_URL" up
   ```
   On Windows PowerShell, wrap the URL in **single quotes** so `$` chars
   in the password aren't expanded.

### 2. Provision Redis on Upstash

1. [console.upstash.com](https://console.upstash.com) → **Create Database**
   → Redis → same region as Neon → **Regional** (not Global) → TLS on.
2. Save: endpoint host, port `6379`, password.
3. Upstash forces TLS — set `REDIS_TLS=true` in the env. The `redisx`
   client in this repo opts into TLS only when this flag is true, so
   local dev with `disable` Postgres SSL still works.

### 3. Deploy API + worker to Fly.io

1. Install:
   ```powershell
   iwr https://fly.io/install.ps1 -useb | iex   # Windows
   curl -L https://fly.io/install.sh | sh        # Linux/Mac
   ```
2. `fly auth signup` (or `fly auth login` if you already have an account).
   A card is required for verification — you won't be charged on the trial credit.
3. **Create both apps** (names must be globally unique on Fly):
   ```powershell
   fly apps create stockapp-api
   fly apps create stockapp-worker
   ```
   If a name is taken, add a suffix and update the `app =` line in the
   matching `fly.*.toml` to match.
4. **Set secrets on the API** (one shot, no backticks):
   ```powershell
   fly secrets set --app stockapp-api `
     APP_ENV=production `
     APP_HTTP_ADDR=:8080 `
     APP_CORS_ORIGINS=* `
     POSTGRES_HOST=ep-xxxx-pooler.region.aws.neon.tech `
     POSTGRES_PORT=5432 `
     POSTGRES_USER=neondb_owner `
     POSTGRES_PASSWORD='your-neon-password' `
     POSTGRES_DB=neondb `
     POSTGRES_SSLMODE=require `
     REDIS_ADDR=your-host.upstash.io:6379 `
     REDIS_PASSWORD='your-upstash-password' `
     REDIS_DB=0 `
     REDIS_TLS=true `
     JWT_SECRET=$(openssl rand -hex 32) `
     JWT_ACCESS_TTL=15m `
     JWT_REFRESH_TTL=720h `
     PRICE_SOURCE=real
   ```
   - Use the **pooled** Neon hostname (with `-pooler`).
   - `REDIS_ADDR` **must** include the port (`:6379`) — Go's redis client
     fails with "missing port in address" if you forget.
   - `APP_CORS_ORIGINS=*` is temporary — tighten in step 6.
5. **Set the same secrets on the worker** (it shares config with the API).
   `JWT_SECRET` is required even though the worker doesn't validate JWTs
   — the shared config struct insists on it. Use any 32+ char string:
   ```powershell
   fly secrets set --app stockapp-worker `
     APP_ENV=production `
     POSTGRES_HOST=...same as above... `
     ...
     JWT_SECRET=worker-doesnt-use-jwt-but-config-requires-this-32-chars-min `
     PRICE_SOURCE=real
   ```
6. **Deploy** (from `backend/`):
   ```powershell
   cd backend
   fly deploy --config fly.api.toml --app stockapp-api
   fly deploy --config fly.worker.toml --app stockapp-worker
   ```
   ~3–4 min each on first deploy, faster on subsequent because layers cache.

7. **Verify the API:**
   ```powershell
   curl https://stockapp-api.fly.dev/healthz
   ```
   Returns `{"status":"ok",...}` when the binary is up.

8. **Verify the worker is polling:**
   ```powershell
   fly logs --app stockapp-worker
   ```
   Look for `fetched yahoo quotes count=N` repeating every ~30s.

### 4. Deploy frontend to Vercel

1. [vercel.com](https://vercel.com) → sign in with GitHub → **Add New →
   Project** → import the repo.
2. **Configure:**
   - **Root Directory**: `frontend` (must edit — auto-detect picks the
     repo root)
   - **Framework Preset**: Vite (auto-detected)
   - **Build Command**: `npm run build` (default)
   - **Output Directory**: `dist` (default)
3. **Environment Variables:**
   ```
   VITE_API_URL = https://stockapp-api.fly.dev
   VITE_WS_URL  = wss://stockapp-api.fly.dev   # NOT ws:// — must be secure
   ```
4. **Deploy.** ~1.5 min build. Copy the resulting URL
   (`https://stockapp-xxx.vercel.app`).

The repo's `frontend/vercel.json` rewrites every unknown path to
`index.html` so React Router survives a hard refresh on deep URLs like
`/stock/RELIANCE`. Without that file, Vercel returns 404 on refresh.

### 5. Tighten CORS

Once you know the Vercel URL, lock CORS to it:

```powershell
fly secrets set APP_CORS_ORIGINS=https://stockapp-xxx.vercel.app --app stockapp-api
```

Fly auto-redeploys in ~30 s.

### 6. End-to-end smoke test

1. Open the Vercel URL → sign up with a fresh email
2. Wallet should show ₹1,00,000 (seeded by migration 000007)
3. Search for `RELIANCE`, click the result, see live price
4. Buy 1 share → wallet drops by current price + brokerage
5. Refresh the page (deep URL) → still loads, doesn't 404
6. Open Profile → Wallet → see the buy with charges breakdown

Total setup time: ~60 min for someone doing it for the first time.
Cost: ₹0 for the first ~2 months on the trial credit, then ~₹170/mo.

---

## Option C — VPS (Hetzner CX22, DigitalOcean, Vultr, Linode)

Cheapest, most control, best resume material. One box running
`docker-compose.prod.yml` exactly as-is.

**Recommended box:** Hetzner Cloud `CX22` — 2 vCPU / 4 GB / 40 GB — **~€4/mo**.

1. **Provision** the box with Ubuntu 24.04 LTS. Note its public IP.
2. **SSH in** and install Docker:
   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER
   # log out/in so the group change takes effect
   ```
3. **Clone the repo** and set up `.env`:
   ```bash
   git clone https://github.com/<you>/<repo>.git stockapp
   cd stockapp
   cp .env.example .env
   nano .env     # set JWT_SECRET, PRICE_SOURCE=real, your API keys, etc.
   # for prod, also:
   echo "APP_CORS_ORIGINS=https://your-domain.example" >> .env
   echo "VITE_API_URL=https://api.your-domain.example" >> .env
   echo "VITE_WS_URL=wss://api.your-domain.example" >> .env
   ```
4. **Bring everything up:**
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   docker compose -f docker-compose.prod.yml --profile tools run --rm migrate up
   ```
5. **Verify:** `curl http://localhost:8080/healthz` should return `{"status":"ok",...}`.
6. **HTTPS with Caddy** — point a domain's A record at the box's IP, then:
   ```bash
   sudo apt install -y caddy
   sudo cp infra/Caddyfile.example /etc/caddy/Caddyfile
   sudo nano /etc/caddy/Caddyfile     # set your two domains + admin email
   sudo systemctl reload caddy
   ```
   `infra/Caddyfile.example` ships with HSTS + the security-header set that
   matches what the API emits. Caddy handles Let's Encrypt automatically —
   no manual cert ops.
7. **Firewall:**
   ```bash
   sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443
   sudo ufw enable
   ```

Total time: ~45 minutes. Cost: ~₹350/mo. Zero vendor lock-in.

**Keep it running:** the `restart: unless-stopped` on every service in
`docker-compose.prod.yml` means they come back after a reboot. Upgrades
are `git pull && docker compose -f docker-compose.prod.yml up -d --build`.

---

## Option D — Cloud (AWS / GCP / Azure)

Worth doing only if you're already in that cloud or explicitly want it on
your CV. Architecture:

- **API + Worker** → **AWS Fargate** / **GCP Cloud Run** / **Azure
  Container Apps**. Serverless containers, autoscale.
- **Postgres** → RDS / Cloud SQL / Azure Postgres.
- **Redis** → ElastiCache / Memorystore / Azure Cache.
- **Frontend** → S3 + CloudFront / GCS + Cloud CDN / Blob + Front Door.
- **CI/CD** → push to ECR / GAR / ACR from the GitHub Actions workflow.

Each of these deserves its own guide — happy to write one if you commit
to a specific cloud. Expect ~₹2,000+/mo minimum at idle.

---

## Pre-flight checks for any option

**Generate a real JWT secret:**
```bash
openssl rand -hex 32
```

**Tighten CORS** — don't ship `*`. Set `APP_CORS_ORIGINS` to exactly the
frontend's public URL(s), comma-separated.

**HTTPS** — required for the browser to allow the secure WebSocket
(`wss://`). Use Caddy, Cloudflare, or the platform's built-in TLS.

**Seed data** is a developer convenience — in a real deployment, let users
register fresh and don't run `cmd/seed`.

**Backups** — at the VPS level, schedule `pg_dump` to an S3 bucket (or the
equivalent on other clouds) via cron. Managed Postgres on Railway / Fly /
RDS handles this for you.

**Monitoring** — at minimum, alert on `/healthz` returning non-200 via
UptimeRobot (free). For more, see the deferred OpenTelemetry task.

---

## Troubleshooting

**"WebSocket failed to connect"** — your frontend is on `https://` but
`VITE_WS_URL` points at `ws://`. Browsers require `wss://` from HTTPS
pages. Rebuild the frontend with the right env var.

**"CORS blocked"** — `APP_CORS_ORIGINS` doesn't exactly match the frontend's
`Origin` header (protocol + host + port). Check with:
```bash
curl -i -H "Origin: https://your-domain.example" https://api.your-domain.example/healthz
```
and confirm the `Access-Control-Allow-Origin` header comes back.

**"500 on every write"** — migrations haven't run on prod.
`docker compose -f docker-compose.prod.yml --profile tools run --rm migrate up`.

**Prices never update** — worker container isn't running. `docker compose
-f docker-compose.prod.yml ps` should show `worker` as `Up`.

### Fly.io-specific

**`redis ping: dial tcp: ... : missing port in address`** — `REDIS_ADDR`
on Fly is missing the `:6379` suffix. Set it via:
```powershell
fly secrets set REDIS_ADDR=your-host.upstash.io:6379 --app stockapp-api
```
Triggers an auto-redeploy.

**`redis ping: EOF` or `connection reset by peer`** — `REDIS_TLS=true` is
not set on Fly. Upstash refuses non-TLS connections. Add it and Fly
auto-redeploys.

**`panic: JWT_SECRET is required`** on the worker — the shared config
struct insists on this value even though the worker doesn't validate
JWTs. Set any 32+ char string:
```powershell
fly secrets set JWT_SECRET=any-32-char-or-more-string --app stockapp-worker
```

**Worker stuck "Configuring firecracker"** without ever reaching
"Starting init" — the machine hit max restart count (10) and got stuck.
Destroy and redeploy:
```powershell
fly machine destroy <machine-id> --app stockapp-worker --force
fly deploy --config fly.worker.toml --app stockapp-worker
```

**Worker shows as `STATE: stopped` and `† Standby machine`** — `fly scale
count 1` kept the standby and there's no primary. Either start the
standby (`fly machine start <id>`) or destroy + redeploy.

**Worker running on 2 machines** — rolling-deploy strategy created an
extra during a redeploy. The price-worker is a singleton (multiple
copies double-poll Yahoo and race in the SIP scheduler). Fix:
```powershell
fly scale count 1 --app stockapp-worker
```
The shipped `fly.worker.toml` has `[deploy] strategy = 'immediate'` to
prevent this on future deploys.

**Vercel returns 404 on refresh of `/stock/RELIANCE` etc.** —
`frontend/vercel.json` is missing or wasn't committed. The file rewrites
all paths to `index.html` so React Router can take over. Push it and
Vercel auto-redeploys.

**Indices show `-`** — Yahoo rate-limits cloud-datacenter IPs. Restart
the worker so it does a fresh poll: `fly machine restart <id> --app
stockapp-worker`. If 429/401 errors persist on `^NSEI`/`^BSESN` in the
logs, that's a Fly→Yahoo network limitation; consider a different data
source for indices.

---

## Fly.io commands cheatsheet

Day-to-day commands you'll reach for after the initial deploy. Run from
the repo root or `backend/` (where the `fly.*.toml` files live).

### Inspection

```powershell
fly apps list                                     # all apps you own
fly status --app stockapp-api                     # service state, latest version, machines
fly machine list --app stockapp-api               # full machine table with IDs
fly logs --app stockapp-api                       # tail logs (live)
fly logs --app stockapp-api | findstr ERROR       # filter on Windows
fly releases --app stockapp-api                   # deploy history
fly secrets list --app stockapp-api               # secret names + last-updated timestamps
fly ips list --app stockapp-api                   # public IPv4 + IPv6
```

### Deploys

```powershell
cd backend
fly deploy --config fly.api.toml --app stockapp-api          # deploy API
fly deploy --config fly.worker.toml --app stockapp-worker    # deploy worker
fly deploy --config fly.api.toml --app stockapp-api --no-cache   # force fresh build
```

### Secrets

```powershell
# Single secret
fly secrets set REDIS_ADDR=your-host.upstash.io:6379 --app stockapp-api

# Multiple secrets in one shot
fly secrets set --app stockapp-api `
  KEY1=value1 `
  KEY2=value2

# Remove a secret
fly secrets unset OLD_FLAG --app stockapp-api
```

Setting/unsetting a secret triggers an auto-redeploy. If the value is
identical to the existing one, Fly skips the redeploy.

### Machines

```powershell
fly machine start <machine-id> --app stockapp-worker
fly machine stop <machine-id> --app stockapp-worker
fly machine restart <machine-id> --app stockapp-worker
fly machine destroy <machine-id> --app stockapp-worker --force
fly scale count 1 --app stockapp-worker      # pin to N machines
fly scale memory 512 --app stockapp-api       # bump RAM (in MB) — costs more
```

### SSH into a running machine

```powershell
fly ssh console --app stockapp-api
```

The image is distroless — no shell. To run a command:

```powershell
fly ssh console --app stockapp-api -C "/app version"
```

### Cleanup

```powershell
fly apps destroy stockapp-api --yes              # delete an entire app
```

Be careful — this is irreversible and frees the global app name for
someone else to claim.

### PowerShell quoting gotchas

When the value contains characters PowerShell expands (`$`, `&`, `;`),
**use single quotes**:

```powershell
fly secrets set POSTGRES_PASSWORD='npg_xxx$yyy' --app stockapp-api
```

Single quotes preserve the literal string. Double quotes will expand
`$yyy` as a variable and silently corrupt the password.
