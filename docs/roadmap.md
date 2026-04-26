# Investment Platform — Source Roadmap

> Extracted from `Investment_Platform_Roadmap.docx` for reference.

Stock & Investment Tracking Platform
Complete End-to-End Roadmap & System Design
Go Backend  ·  React Frontend  ·  Real-Time Market Data

1. Project Overview
This is a production-grade full-stack investment tracking platform that mirrors the core product of companies like IndMoney, Groww, Zerodha, and Upstox. It allows users to manage multi-asset portfolios (stocks, mutual funds, crypto), track live market prices in real time, calculate true annualized returns (XIRR), schedule SIP investments, and view an immutable audit trail of every transaction.
The project is designed to be a strong CV piece targeting fintech backend and full-stack roles. Every major feature maps directly to a real product feature that interviewers at these companies work on daily.
Why this project stands out
Real-time WebSocket price feed — live P&L that updates as the market moves
XIRR implementation — most engineers have never built this; it is memorable in interviews
Double-entry bookkeeping ledger — demonstrates fintech-grade transaction safety
Event-driven architecture with Kafka — mirrors production fintech infrastructure
Full frontend with TradingView charts — visually identical to the real products

2. Target Companies
This project directly targets the following companies and roles:
Company
Why this project fits
Relevant features
IndMoney
Direct match — portfolio, live prices, SIP
P&L engine, SIP scheduler
Groww
MF + stocks dashboard with real-time data
Holdings table, price charts
Zerodha
Trading platform with P&L and order history
Ledger, XIRR, audit log
Upstox
Brokerage with real-time WebSocket feed
Price ingestion pipeline
Razorpay / Cashfree
Fintech infra — transaction reliability
Double-entry ledger
CRED / Jupiter / Fi
Consumer fintech, portfolio features
Full-stack product match


3. Full Tech Stack
Backend
Layer
Technology
Purpose
Language
Go 1.22+
Core backend language
HTTP / Router
net/http + chi
REST API routing and middleware
WebSockets
gorilla/websocket
Real-time price streaming
Message Broker
Apache Kafka
Async event bus between services
Cache & Pub/Sub
Redis 7
Live prices, sessions, pub/sub fan-out
Database
PostgreSQL 15
Persistent storage for all data
DB Migrations
golang-migrate
Schema versioning
Config
Viper
Environment-based configuration
Logging
zerolog
Structured JSON logging
Auth
JWT + bcrypt
Stateless auth with refresh tokens
Containerization
Docker + Compose
Local development environment

Frontend
Layer
Technology
Purpose
Framework
React 18 + TypeScript
Component-based UI
State
Zustand
Lightweight global state
Server state
TanStack Query
API caching and sync
Tables
TanStack Table
Sortable, filterable holdings
Charts
TradingView Lightweight Charts
Candlestick / line charts
Charts (other)
Recharts
Donut, bar, area charts
Styling
TailwindCSS
Utility-first CSS
WebSocket
Native WS API
Live price subscription
Routing
React Router v6
SPA navigation
Build
Vite
Fast bundler
Deployment
Vercel
Frontend hosting

External APIs
Service
Provider
Usage
Stock prices
Polygon.io (free tier)
Real-time & historical OHLCV data
Fallback prices
Yahoo Finance API
Backup price feed
Market news
NewsAPI.org (free)
Per-stock news articles
Crypto prices
CoinGecko (free)
Crypto portfolio support


4. System Design
High-Level Architecture
The system is composed of independent backend services that communicate via Kafka for async operations and direct HTTP/WebSocket for synchronous requests. Redis handles ephemeral real-time state; PostgreSQL stores all persistent data.
Services
User Service: Handles registration, login, JWT issuance and refresh. Stores hashed passwords in Postgres.
Portfolio Service: Manages user portfolios and holdings. Calculates current value, P&L, day change by combining holding data with live prices from Redis.
Transaction Service: Records every buy/sell using double-entry bookkeeping. Uses SELECT FOR UPDATE to prevent race conditions. Writes to both the transactions table and the append-only audit_log.
Price Ingestion Service: Opens a WebSocket to Polygon.io, subscribes to ticker symbols of all active holdings, writes latest price to Redis using SET with TTL, and publishes price_updated events to Kafka.
P&L Engine: Kafka consumer that listens to price_updated events. Recalculates portfolio value and P&L for each affected user and pushes the update to the Notification Service.
SIP Scheduler: Cron-based service that runs every minute, checks for due SIP jobs, and processes them atomically. Publishes sip.executed events.
Notification Service: Manages WebSocket connections from browser clients. Maintains a hub mapping user_id to active connections. Pushes real-time P&L updates and alerts.
Alert Service: Consumes price_updated events. Checks if any user has a price alert set for the ticker. If threshold crossed, publishes alert.triggered event.
Data Flow — Live Price Update
1.  Polygon.io WebSocket pushes a new price tick for RELIANCE
2.  Price Ingestion Service writes to Redis: SET price:RELIANCE 2450.50 EX 60
3.  Service publishes event to Kafka topic price.updated: {ticker, price, timestamp}
4.  P&L Engine consumes the event, queries all portfolios holding RELIANCE, recalculates P&L
5.  P&L Engine publishes portfolio.updated events per affected user
6.  Notification Service receives portfolio.updated, finds open WebSocket connection for that user
7.  Notification Service pushes the updated P&L to the browser in real time
8.  Alert Service in parallel checks if any user has a price alert for RELIANCE
Kafka Topics
Topic
Producer
Consumer
Partition key
price.updated
Price Ingestion
P&L Engine, Alert
ticker
portfolio.updated
P&L Engine
Notification Svc
user_id
transaction.created
Transaction Svc
Audit Service
user_id
sip.executed
SIP Scheduler
Notification Svc
user_id
alert.triggered
Alert Service
Notification Svc
user_id


5. Database Schema
Core PostgreSQL tables:
users
id UUID PRIMARY KEY
email VARCHAR(255) UNIQUE NOT NULL
password_hash VARCHAR(255) NOT NULL
created_at TIMESTAMPTZ DEFAULT NOW()
portfolios
id UUID PRIMARY KEY
user_id UUID REFERENCES users(id)
name VARCHAR(100)
created_at TIMESTAMPTZ DEFAULT NOW()
holdings
id UUID PRIMARY KEY
portfolio_id UUID REFERENCES portfolios(id)
ticker VARCHAR(20) NOT NULL
asset_type VARCHAR(20)   -- stock | mf | crypto
quantity NUMERIC(18,6) NOT NULL
avg_buy_price NUMERIC(18,2) NOT NULL
updated_at TIMESTAMPTZ
transactions
id UUID PRIMARY KEY
user_id UUID REFERENCES users(id)
portfolio_id UUID REFERENCES portfolios(id)
ticker VARCHAR(20) NOT NULL
type VARCHAR(10)  -- buy | sell
quantity NUMERIC(18,6)
price NUMERIC(18,2)
total_amount NUMERIC(18,2)
executed_at TIMESTAMPTZ DEFAULT NOW()
sip_plans
id UUID PRIMARY KEY
user_id UUID REFERENCES users(id)
ticker VARCHAR(20)
amount NUMERIC(18,2)
frequency VARCHAR(20)  -- daily | weekly | monthly
next_run_at TIMESTAMPTZ
status VARCHAR(20)  -- active | paused | cancelled
audit_log
id BIGSERIAL PRIMARY KEY
user_id UUID
action VARCHAR(50)
entity_type VARCHAR(50)
entity_id UUID
payload JSONB
created_at TIMESTAMPTZ DEFAULT NOW()
-- Append-only. Never updated or deleted.
price_alerts
id UUID PRIMARY KEY
user_id UUID REFERENCES users(id)
ticker VARCHAR(20)
target_price NUMERIC(18,2)
direction VARCHAR(10)  -- above | below
triggered BOOLEAN DEFAULT FALSE

6. Phase-by-Phase Roadmap
Phase 1 — Foundation — Backend Core   (~1 week)
Project setup: Go modules, chi router, Docker Compose with Postgres + Redis + Kafka, Viper config, zerolog structured logging
User service: Registration, login, JWT access + refresh tokens, bcrypt password hashing, middleware for protected routes
Portfolio service: Create portfolio, add/remove holdings, multi-asset support (stocks, MF, crypto), basic CRUD endpoints
Transaction ledger: Buy/sell with double-entry bookkeeping, atomic DB transactions using SELECT FOR UPDATE, write to audit_log on every action
DB migrations: Set up golang-migrate, write all initial SQL migration files
Deliverable: A fully functional REST API for user auth, portfolio management, and trade execution.
Phase 2 — Market Data Pipeline   (~2 weeks)
Price ingestion service: WebSocket connection to Polygon.io, subscribe to all active tickers, write latest price to Redis, publish price.updated to Kafka
P&L engine: Consume price.updated, calculate absolute return, day change %, total invested vs current value per holding and portfolio
XIRR calculator: Implement Newton-Raphson XIRR algorithm — true annualized return accounting for timing of each cash flow
SIP scheduler: Cron-based job runner, fetch due SIPs every minute, process atomically with DB transaction, publish sip.executed
Price alerts: Users set price targets per ticker; Alert Service consumes price.updated and checks thresholds; triggers notification
News feed: Per-stock news via NewsAPI, attach sentiment label, store in Redis with 1-hour TTL
Deliverable: Live portfolio value that updates in real time as market prices change, with XIRR and SIP working end-to-end.
Phase 3 — Frontend — React Dashboard   (~2 weeks)
Portfolio overview page: Total value card, P&L in green/red, day change ticker, allocation donut chart (Recharts), summary stats grid
Live price chart: TradingView Lightweight Charts with real-time WebSocket updates, 1D / 1W / 1M / 1Y / ALL range selector
Holdings table: TanStack Table with sortable columns, color-coded P&L, inline buy/sell buttons, search/filter
Transaction history: Paginated log of all buy/sell actions, date range filter, asset filter, CSV export button
SIP dashboard: List of active SIPs, next deduction date, projected growth area chart, pause/resume/cancel controls
Stock search: Debounced search bar hitting backend, quote preview card with mini chart, one-click add to portfolio
Alerts UI: Set price alerts per holding, list of active alerts, history of triggered alerts
News feed UI: Per-stock news cards with sentiment badge, linked to holdings in portfolio
Deliverable: A fully functional, visually polished React dashboard that looks and feels like a real investment app.
Phase 4 — Advanced Features   (~1 week)
Allocation analysis: Sector-wise, asset-type, and risk-level breakdowns; rebalancing suggestions based on target allocation
XIRR display: Show XIRR per individual holding and overall portfolio; explain calculation inline with tooltip
Audit log UI: Full immutable timeline of every action per user; styled as regulatory-ready activity feed
Portfolio comparison: Compare portfolio performance vs Nifty 50 / Sensex benchmark over selected time range
Export features: Download portfolio snapshot as CSV, transaction history as CSV or PDF statement
Deliverable: A feature-complete product with analyst-grade portfolio analytics and a robust audit trail.
Phase 5 — Polish, Deploy & Document   (~1 week)
Deployment: Backend services on Railway or Fly.io; frontend on Vercel; environment variables, HTTPS, custom domain
CI/CD pipeline: GitHub Actions: lint + test on PR, auto-deploy main to staging, manual promote to prod
README & docs: Architecture diagram, API reference, system design decisions, local setup guide, demo screenshots
Demo video: 2-minute screen recording showing live price updates, P&L movement, buy/sell flow, SIP setup
CV talking points: Prepare answers for: why Kafka, how you prevent double-spend, how XIRR works, WebSocket scaling strategy
Deliverable: A live, publicly accessible product with a great GitHub README and a demo video linked from your CV.

7. Project Structure
Backend (Go)
investment-platform/├── cmd/│   ├── user-service/│   ├── portfolio-service/│   ├── transaction-service/│   ├── price-ingestion/│   ├── pnl-engine/│   ├── sip-scheduler/│   ├── alert-service/│   └── notification-service/├── internal/│   ├── user/│   │   ├── handler.go│   │   ├── service.go│   │   └── repository.go│   ├── portfolio/│   ├── transaction/│   │   ├── ledger.go       # double-entry logic│   │   └── audit.go        # append-only audit log│   ├── price/│   │   ├── ingestion.go    # WebSocket → Redis → Kafka│   │   └── cache.go│   ├── pnl/│   │   ├── calculator.go│   │   └── xirr.go         # Newton-Raphson XIRR│   ├── sip/│   │   ├── scheduler.go│   │   └── processor.go│   └── notification/│       └── hub.go          # WebSocket connection hub├── pkg/│   ├── kafka/│   ├── redis/│   ├── postgres/│   ├── middleware/         # auth, rate limit, logger│   └── jwt/├── migrations/├── docker-compose.yml└── README.md
Frontend (React + TypeScript)
frontend/├── src/│   ├── pages/│   │   ├── Dashboard.tsx       # portfolio overview│   │   ├── Holdings.tsx        # holdings table│   │   ├── Transactions.tsx    # trade history│   │   ├── SIPDashboard.tsx    # SIP management│   │   ├── StockDetail.tsx     # chart + news│   │   └── AuditLog.tsx│   ├── components/│   │   ├── PriceChart.tsx      # TradingView chart│   │   ├── HoldingsTable.tsx   # TanStack Table│   │   ├── PnLCard.tsx         # green/red metric card│   │   ├── AllocationChart.tsx # donut chart│   │   └── AlertForm.tsx│   ├── hooks/│   │   ├── useLivePrices.ts    # WebSocket hook│   │   └── usePortfolio.ts│   ├── store/│   │   └── portfolio.ts        # Zustand store│   ├── api/│   │   └── client.ts           # axios + TanStack Query│   └── types/│       └── index.ts

8. Frontend Screens & UI Details
Portfolio Overview
Hero row: Total Value (large), Total Invested, Overall P&L (green/red), Day Change
Allocation donut chart — breakdown by asset type (stocks / MF / crypto)
Top gainers and top losers today — two small cards side by side
Market status indicator — Market Open / Closed badge

Holdings Table
Columns: Stock, Qty, Avg Buy Price, Current Price, Current Value, P&L (₹), P&L (%)
P&L column color-coded: green for profit, red for loss
Sortable by any column; search/filter by ticker or name
Inline Buy More and Sell buttons per row
Row expands to show mini sparkline chart for past 7 days

Stock Detail Page
TradingView Lightweight Chart — line mode by default, toggle to candlestick
Time range selector: 1D / 1W / 1M / 3M / 1Y / ALL
Real-time price update via WebSocket — price ticks in live
My position card: qty, avg price, current value, P&L, XIRR
Set price alert button — modal with above/below threshold input
News feed — 5 latest articles from NewsAPI with sentiment badge

Transaction History
Paginated table: Date, Type (Buy/Sell), Ticker, Qty, Price, Total
Filter by date range, asset, and transaction type
Download as CSV button
Running portfolio value chart above the table — area chart showing net worth over time

SIP Dashboard
Active SIPs list with ticker, amount, frequency, next run date
Projected value card — shows estimated corpus at 5/10/15 years
SIP growth area chart — invested vs current value over time
Create new SIP modal, pause/resume/cancel per SIP

Audit Log
Chronological timeline of every action: buy, sell, SIP, alert set, login
Each entry shows timestamp, action type badge, entity, and full payload
Filter by action type and date range
Styled as a regulatory-grade activity feed — immutable, no edit/delete


9. Key Design Decisions
These are the decisions you should be able to explain confidently in interviews:
Why Kafka over direct HTTP between services?: Services are fully decoupled. If the P&L Engine is down, price.updated events queue in Kafka and are processed when it recovers — no data loss. This gives at-least-once delivery and fault tolerance for free. With direct HTTP calls, a service crash means lost events.

Why Redis for live prices instead of Postgres?: Prices update every few seconds per ticker. Writing thousands of rows per minute to Postgres is wasteful and slow. Redis SET is O(1) and keeps only the latest price in memory. Postgres stores only the historical OHLCV data fetched in batch.

Why SELECT FOR UPDATE in transactions?: When a user submits a sell order, we lock the holdings row before reading quantity. Without this, two concurrent sell requests could both read the same quantity and both succeed — causing the quantity to go negative. This is the standard way to prevent race conditions in financial systems.

Why an append-only audit_log table?: In fintech, you must be able to reconstruct exactly what happened to a user's account at any point in time. The transactions table holds current state; audit_log holds the full immutable history. This follows the Event Sourcing pattern and is a regulatory requirement in real financial products.

Why XIRR instead of simple returns?: Simple return (current value / invested - 1) does not account for the timing of investments. If you invested ₹10,000 in January and ₹10,000 in December, the January investment has had a full year to grow. XIRR gives each cash flow its correct time weight — it is the metric IndMoney, Groww, and Zerodha all show to their users.

Why partition Kafka topics by user_id?: All events for a single user go to the same partition, guaranteeing that the P&L engine and notification service process events in the correct order for that user. Without this, a portfolio.updated event could arrive before the transaction.created event that caused it.


10. Timeline Summary
Phase
Focus
Duration
Mode
Phase 1
Backend foundation — auth, portfolio, ledger
1 week
Backend only
Phase 2
Market data pipeline — prices, P&L, SIP, alerts
2 weeks
Backend only
Phase 3
React frontend — all screens and charts
2 weeks
Frontend only
Phase 4
Advanced analytics — XIRR, allocation, export
1 week
Full stack
Phase 5
Polish, deploy, document, demo video
1 week
DevOps + Docs
TOTAL

~7 weeks
Evenings & weekends
This is realistic at ~2-3 hours per weekday evening plus weekend time. The most demanding phase is Phase 2 (market data pipeline) — budget extra time there.

11. Interview Talking Points
For every senior engineer interviewing you, these are the questions you will get. Prepare a 1-2 minute answer for each.
"Walk me through your system design."
"Why did you choose Kafka? What are the tradeoffs vs a job queue like BullMQ?"
"How do you prevent a user from selling more shares than they own?"
"What happens if the price ingestion service goes down for 5 minutes?"
"How does XIRR work? Why is it better than simple returns?"
"How do you scale the WebSocket notification service to 100,000 concurrent users?"
"Why is the audit_log append-only? What is event sourcing?"
"How would you add support for options trading to this platform?"

12. Future Improvements (Post-MVP)
Options and derivatives support — add options chain viewer and Greeks calculator
Tax P&L report — short-term vs long-term gains, downloadable tax statement
Multi-currency support — US stocks in USD with live FX conversion
Social features — follow other investors, see aggregate sentiment on a stock
AI insights — LLM-powered portfolio health analysis and rebalancing suggestions
Mobile app — React Native with the same WebSocket feed
Paper trading mode — simulate trades without real money for backtesting
Kubernetes deployment manifests — for production-grade scaling demo
Prometheus + Grafana — observability dashboard for all services
Load testing with k6 — benchmark WebSocket throughput and price ingestion rate
