# Oracle Cloud Always Free deploy

End-to-end walkthrough to host **the entire stack** — Postgres, Redis, API,
worker, frontend, Caddy/HTTPS — on a single Oracle Cloud Always Free ARM VM
for **₹0/month, forever**. This is the recommended path for the live demo.

> Why Oracle Cloud Free? 4 ARM Ampere vCPUs + 24 GB RAM, no expiry, no credit
> card draw. Plenty of headroom — `docker-compose.prod.yml` idles at well
> under 1 GB.

What you'll have at the end:
- A 4 vCPU / 24 GB ARM VM running the full stack
- A free `<your-name>.duckdns.org` subdomain
- HTTPS via Caddy + Let's Encrypt — auto-renewed
- The whole thing comes back after a reboot (`restart: unless-stopped`)

---

## 0. Prerequisites

- Oracle Cloud account (verified — they may take a few hours after sign-up)
- This repo pushed to GitHub
- A DuckDNS account at https://www.duckdns.org/ (sign in with GitHub — free)

---

## 1. Provision the ARM VM

1. Sign in at https://cloud.oracle.com.
2. Top-left hamburger → **Compute → Instances → Create instance**.
3. **Name:** `stockapp` (anything works).
4. **Image and shape → Edit:**
   - Image: **Canonical Ubuntu 24.04**
   - Shape: click **Change shape** → **Ampere → VM.Standard.A1.Flex**
   - OCPUs: **4** · Memory (GB): **24** (full free allowance)
   - Look for the green **"Always Free Eligible"** badge
5. **Networking:** keep defaults — Oracle creates a VCN + subnet automatically.
   Ensure **"Assign a public IPv4 address"** is ticked.
6. **Add SSH keys:** click **Generate a key pair for me** → **Save private key**
   (you'll get `ssh-key-XXXX.key`). Save the public key too.
7. **Boot volume:** keep default (47 GB free).
8. Click **Create**. Provisioning takes 1–2 min.

> **If "Out of capacity" error:** ARM capacity is tight in popular regions.
> Either retry every few minutes, or recreate your account picking a less
> busy home region (Mumbai/Hyderabad are usually crowded; try Tokyo or
> Frankfurt — latency from India is still ~150 ms, fine for a demo).

Once running, copy the **Public IP Address** from the instance page — let's
call it `<VM_IP>`.

---

## 2. Open ports 80 and 443

Oracle blocks inbound traffic at **two layers**. Both must be opened.

### 2a. VCN Security List (cloud firewall)

1. Instance page → **Subnet** link → **Default security list**.
2. **Add Ingress Rules** — add two:

   | Source CIDR | IP Protocol | Destination Port |
   |---|---|---|
   | `0.0.0.0/0` | TCP | `80` |
   | `0.0.0.0/0` | TCP | `443` |

### 2b. Linux iptables (host firewall)

The Ubuntu image ships with iptables blocking everything except SSH. Open
the same two ports on the host (we'll do this in the next section after
SSH-ing in).

---

## 3. SSH in

On Windows, set the key file's permissions before using it:

```powershell
icacls "C:\path\to\ssh-key-XXXX.key" /inheritance:r /grant:r "$($env:USERNAME):R"
```

Then:

```bash
ssh -i ssh-key-XXXX.key ubuntu@<VM_IP>
```

> First connection asks to trust the host key — type `yes`.

---

## 4. Open the host firewall + install Docker

All commands below run **on the VM** as the `ubuntu` user.

```bash
# Persist iptables rules across reboot
sudo apt update && sudo apt install -y iptables-persistent

# Open 80 and 443 (insert before the catch-all REJECT rule that Oracle adds)
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save

# Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

# Apply group change without re-login
exec sg docker newgrp `id -gn`
docker version    # should print Client + Server versions
```

---

## 5. Clone and configure

```bash
git clone https://github.com/<your-username>/<repo>.git stockapp
cd stockapp

cp .env.example .env
nano .env
```

Edit `.env` — fill these:

```ini
APP_ENV=production
APP_CORS_ORIGINS=https://<your-subdomain>.duckdns.org

JWT_SECRET=<paste output of: openssl rand -hex 32>

PRICE_SOURCE=real          # Yahoo + mfapi — no keys, no daily token chore
# Or PRICE_SOURCE=upstox + the three UPSTOX_ vars if you have a developer app

VITE_API_URL=https://api.<your-subdomain>.duckdns.org
VITE_WS_URL=wss://api.<your-subdomain>.duckdns.org
```

> **Important:** `VITE_*` are baked into the frontend bundle at *build time*.
> If you change them later, you must rebuild the frontend container.

Generate the JWT secret directly in the shell:

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
# then nano .env again and remove the placeholder line
```

---

## 6. Get your free DuckDNS subdomain

1. https://www.duckdns.org → sign in with GitHub.
2. Pick a subdomain — say `mystockapp`. You now own `mystockapp.duckdns.org`.
3. Set the **current ip** field to your `<VM_IP>` and click **update ip**.
4. Add a second domain in the same dashboard for the API: `api-mystockapp`
   (DuckDNS doesn't allow real subdomains-of-subdomains on the free tier,
   so use a sibling). Update the same `<VM_IP>`.

> Update the `.env` you just wrote so `APP_CORS_ORIGINS`, `VITE_API_URL`,
> `VITE_WS_URL` use the actual DuckDNS names you picked. e.g.
> `VITE_API_URL=https://api-mystockapp.duckdns.org`.

DNS propagation is near-instant on DuckDNS — verify with:

```bash
dig +short mystockapp.duckdns.org       # should print <VM_IP>
dig +short api-mystockapp.duckdns.org   # same
```

---

## 7. Bring the stack up

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml --profile tools run --rm migrate up

# Sanity check
curl http://localhost:8080/healthz
# {"status":"ok","time":"..."}
docker compose -f docker-compose.prod.yml ps
# api, worker, frontend, postgres, redis — all "Up"
```

First build takes ~5 min on ARM (Go + Node from scratch). Subsequent rebuilds
are minutes.

---

## 8. HTTPS via Caddy

Install Caddy:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
    sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
    sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Use the templated Caddyfile from this repo:

```bash
sudo cp ~/stockapp/infra/Caddyfile.example /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile
```

Edit just three things in the file:

1. `email admin@example.com` → your email (Let's Encrypt expiry alerts)
2. First site block: replace `your-domain.example` with `mystockapp.duckdns.org`
3. Second site block: replace `api.your-domain.example` with
   `api-mystockapp.duckdns.org`

Then:

```bash
sudo systemctl reload caddy
sudo journalctl -u caddy -f       # watch the cert provisioning
```

You'll see Caddy contact Let's Encrypt and obtain certs within ~30 seconds.

---

## 9. Verify

Open in a browser:

- **Frontend:** https://mystockapp.duckdns.org → app loads, padlock shows
- **API:** https://api-mystockapp.duckdns.org/healthz → returns `{"status":"ok",...}`
- **WebSocket:** the dashboard's connection dot turns green when ticks arrive

Login with the seeded demo account (if you ran `cmd/seed`) or register fresh.

---

## 10. Set up monitoring (optional, free)

UptimeRobot — pings your `/healthz` every 5 min, alerts your email on outage:

1. Sign up at https://uptimerobot.com (free for 50 monitors).
2. **Add New Monitor → HTTP(s)**
3. URL: `https://api-mystockapp.duckdns.org/healthz`
4. Monitoring Interval: 5 min
5. Alert Contacts: your email

---

## Daily/weekly upkeep

| Task | How |
|---|---|
| **Pull a new release** | `cd ~/stockapp && git pull && docker compose -f docker-compose.prod.yml up -d --build` |
| **Refresh Upstox token** (only if `PRICE_SOURCE=upstox`) | `cd backend && go run ./cmd/upstox-login`, paste new token into `.env`, `docker compose -f docker-compose.prod.yml restart worker api` |
| **Update DuckDNS IP** (only if Oracle changes the public IP — rare) | One curl from the DuckDNS panel; or set up the cron updater they provide |
| **DB backup** | `docker compose -f docker-compose.prod.yml exec postgres pg_dump -U stockapp stockapp > backup-$(date +%F).sql` — drop into a cron job pointing at S3/B2 if you want offsite |

---

## Troubleshooting

**"Connection refused" on `https://...`** — Caddy hasn't started or can't reach
Let's Encrypt. Check `sudo journalctl -u caddy -f`. Most common cause: port
80 not actually open (re-check VCN security list **and** iptables).

**Browser "WebSocket failed to connect"** — `VITE_WS_URL` is `ws://`
(plaintext). Edit `.env` to `wss://`, then rebuild the frontend container:
`docker compose -f docker-compose.prod.yml up -d --build frontend`.

**500 on every write** — migrations didn't run. From the project dir:
`docker compose -f docker-compose.prod.yml --profile tools run --rm migrate up`.

**Worker shows zero ticks** — if `PRICE_SOURCE=upstox`, the daily token
expired (~3:30 AM IST). For a hands-off demo, switch to `PRICE_SOURCE=real`
in `.env` and `docker compose -f docker-compose.prod.yml restart worker`.

**Out of memory during build** — A1.Flex with 24 GB never hits this; if you
provisioned a smaller shape, upgrade to the full free allowance.

**Want to nuke and start over** —
`docker compose -f docker-compose.prod.yml down -v` wipes all containers
and volumes (including the database).

---

## Cost confirmation

Oracle Always Free covers, indefinitely:

- Up to 4 OCPUs + 24 GB RAM total across Ampere A1.Flex instances
- 200 GB total block volume
- 10 TB egress per month
- 1 free public IPv4 per VM

This deployment uses **all 4 OCPUs / 24 GB on one VM**, ~50 GB block volume,
and (at demo traffic) well under 100 GB egress/month. Zero charges, no card
on file.

If Oracle ever changes the free tier terms, your VM keeps running — they
notify before any change.
