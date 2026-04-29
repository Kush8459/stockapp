# Investment Platform -- developer shortcuts.
# Works on bash/zsh (macOS/Linux/WSL/Git Bash).
#
# Usage: `make help`

SHELL := /bin/bash
.DEFAULT_GOAL := help

# --- infra ---
.PHONY: dev-up dev-down dev-logs
dev-up: ## Start Postgres + Redis in the background
	docker compose up -d postgres redis

dev-down: ## Stop & remove infra containers (keeps volumes)
	docker compose down

dev-reset: ## Stop & remove infra + wipe volumes
	docker compose down -v

dev-logs: ## Tail infra logs
	docker compose logs -f postgres redis

# --- migrations ---
.PHONY: migrate-up migrate-down migrate-new
migrate-up: ## Apply all pending SQL migrations
	docker compose --profile tools run --rm migrate up

# --- observability ---
.PHONY: obs-up obs-down obs-logs
obs-up: ## Start prometheus + grafana (Grafana on :3000, Prom on :9090)
	docker compose --profile observability up -d prometheus grafana
	@echo "Grafana: http://localhost:3000 (admin/admin) — board: 'Stockapp · API & Trading'"
	@echo "Prometheus: http://localhost:9090"

obs-down: ## Stop prometheus + grafana
	docker compose --profile observability down

obs-logs: ## Tail observability logs
	docker compose --profile observability logs -f prometheus grafana


migrate-down: ## Roll back the most recent migration
	docker compose --profile tools run --rm migrate down 1

migrate-new: ## Create a new migration pair (use name=add_thing)
	@if [ -z "$(name)" ]; then echo "usage: make migrate-new name=add_something"; exit 1; fi
	@mkdir -p backend/migrations
	@ts=$$(date +%Y%m%d%H%M%S); \
	touch backend/migrations/$${ts}_$(name).up.sql backend/migrations/$${ts}_$(name).down.sql; \
	echo "created backend/migrations/$${ts}_$(name).{up,down}.sql"

# --- backend ---
.PHONY: be-run be-build be-tidy be-test be-worker
be-run: ## Run the API server
	cd backend && go run ./cmd/server

be-worker: ## Run the price worker (uses PRICE_SOURCE from .env)
	cd backend && go run ./cmd/price-worker

upstox-login: ## Refresh the daily Upstox access token (stop API server first)
	cd backend && go run ./cmd/upstox-login

be-build: ## Build backend binaries into backend/bin
	cd backend && go build -o bin/server ./cmd/server && go build -o bin/price-worker ./cmd/price-worker && go build -o bin/upstox-login ./cmd/upstox-login

be-tidy: ## Tidy Go modules
	cd backend && go mod tidy

be-test: ## Run backend unit tests
	cd backend && go test ./...

# --- frontend ---
.PHONY: fe-install fe-dev fe-build fe-preview
fe-install: ## Install frontend deps
	cd frontend && npm install

fe-dev: ## Run Vite dev server
	cd frontend && npm run dev

fe-build: ## Production build
	cd frontend && npm run build

fe-preview: ## Preview the production build
	cd frontend && npm run preview

# --- seed ---
.PHONY: seed
seed: ## Insert demo user + holdings (requires migrate-up first)
	docker compose exec -T postgres psql -U $${POSTGRES_USER:-stockapp} -d $${POSTGRES_DB:-stockapp} < backend/migrations/seed.sql

# --- help ---
.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "; printf "\n\033[1mInvestment Platform\033[0m\n\n"} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo
