# Deployment

This doc picks a hosting target, walks through each option, and lists the
exact environment variables the server needs in production.

## TL;DR — pick one

| Option | Best for | Cost (roughly) | Setup time |
|---|---|---|---|
| **Oracle Cloud Always Free** | CV / portfolio — recommended | **₹0 forever** (4 vCPU + 24 GB ARM) | 60 min — see [`oracle-deploy.md`](oracle-deploy.md) |
| **Railway** | Easiest paid path | Free credits, ~₹400/mo after | 15 min |
| **Fly.io** | Low-traffic production | Free tier covers it, ~₹0 at demo scale | 30 min |
| **Hetzner Cloud / DO / Vultr VPS** | Full control, paid scale | ~₹350–500/mo | 45 min |
| **AWS / GCP** | If a team already lives there | ~₹2,000+/mo | A day |

For a CV / portfolio project the recommended path is **Oracle Cloud Free**
(genuinely free forever, runs the whole `docker-compose.prod.yml` on one
ARM box, zero cold starts). The full guide lives in
[`oracle-deploy.md`](oracle-deploy.md) — that's the doc to follow if you're
deploying right now.

Hetzner/DO/Vultr give you the same architecture but cost ~₹350/mo. Railway
is the button-click option when you don't want to own a box.

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

## Option B — Fly.io (cheapest at this scale)

Fly's free tier covers 3 small VMs, one Postgres, and 3 GB of storage —
enough for this project at demo traffic.

1. Install: `curl -L https://fly.io/install.sh | sh` then `fly auth login`.
2. **Launch Postgres:**
   ```bash
   fly postgres create --name stockapp-db --region sin
   ```
   Save the connection string it prints.
3. **Redis:** Fly doesn't host Redis directly; use **Upstash Redis for Fly**:
   ```bash
   fly ext upstash redis create --region sin
   ```
   Save `REDIS_URL`.
4. **Deploy the API**:
   ```bash
   cd backend
   fly launch --no-deploy --name stockapp-api \
     --image-label dev --region sin --copy-config=false
   ```
   Edit the generated `fly.toml` so `internal_port = 8080`.
   Set secrets:
   ```bash
   fly secrets set \
     JWT_SECRET=$(openssl rand -hex 32) \
     POSTGRES_HOST=... POSTGRES_USER=... POSTGRES_PASSWORD=... POSTGRES_DB=... \
     REDIS_ADDR=... REDIS_PASSWORD=... \
     APP_CORS_ORIGINS=https://stockapp-web.fly.dev
   fly deploy
   ```
5. **Deploy the worker** — separate app with `TARGET=price-worker` build arg,
   same secrets, no public service port.
6. **Deploy the frontend** — Fly has `fly launch` for Dockerfiles:
   ```bash
   cd frontend
   fly launch --name stockapp-web --region sin \
     --build-arg VITE_API_URL=https://stockapp-api.fly.dev \
     --build-arg VITE_WS_URL=wss://stockapp-api.fly.dev
   ```
7. **Run migrations** from your laptop against the public Postgres URL
   (same as the Railway example above).

Total time: ~30 minutes. Cost: ₹0–₹400/mo depending on traffic.

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
