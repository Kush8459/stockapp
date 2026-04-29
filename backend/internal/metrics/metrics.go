// Package metrics owns every Prometheus metric used by the API + worker.
//
// All metrics are registered against a single sub-registry so /metrics never
// exposes the default Go runtime metrics duplicated. Callers update them
// from anywhere via the package-level vars (ApiRequestSeconds, TradeTotal,
// etc.). Names follow the Prometheus convention: lowercase_with_underscores,
// units in the suffix (`_seconds`, `_total`, `_bytes`).
package metrics

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Registry is the single registry every metric is registered against.
// Callers also use it to construct the /metrics handler.
var Registry = prometheus.NewRegistry()

// ── HTTP / API surface ───────────────────────────────────────────────────

// ApiRequestSeconds is observed by the HTTP middleware on every request.
// Buckets cover 1ms → 5s, sufficient for both fast cache hits and slow
// upstream calls.
var ApiRequestSeconds = prometheus.NewHistogramVec(
	prometheus.HistogramOpts{
		Name:    "api_request_seconds",
		Help:    "Latency of API HTTP requests, by route + method + status code class.",
		Buckets: prometheus.DefBuckets,
	},
	[]string{"route", "method", "status_class"},
)

// ── Trades / wallet ──────────────────────────────────────────────────────

// TradeTotal counts every successful buy/sell. Side + asset_type help
// filter "all MF buys today" or "all stock sells this week" in Grafana.
var TradeTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "trade_total",
		Help: "Trades executed by the transaction service.",
	},
	[]string{"side", "asset_type", "source"},
)

// TradeFailedTotal counts trades that errored out, labelled by the error
// kind we expose to clients. Useful for "did the wallet balance gate
// reject more buys than usual?" alerts.
var TradeFailedTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "trade_failed_total",
		Help: "Trades rejected before commit.",
	},
	[]string{"reason"},
)

// TradeExecuteSeconds measures end-to-end latency of transaction.Execute,
// which includes the SERIALIZABLE outer transaction. The serialise-wait
// histogram lives here too — interview gold.
var TradeExecuteSeconds = prometheus.NewHistogramVec(
	prometheus.HistogramOpts{
		Name:    "trade_execute_seconds",
		Help:    "End-to-end latency of transaction.Execute.",
		Buckets: []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5},
	},
	[]string{"side", "asset_type"},
)

// WalletMovementTotal counts every wallet_transactions write (deposit,
// withdraw, trade-side debit/credit, charge).
var WalletMovementTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "wallet_movement_total",
		Help: "wallet_transactions rows created, by kind.",
	},
	[]string{"kind"},
)

// ── SIPs ────────────────────────────────────────────────────────────────

// SipRunTotal counts each SIP execution attempt. Status values:
// `executed`, `skipped_no_price`, `paused_low_balance`, `failed`.
var SipRunTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "sip_run_total",
		Help: "SIP scheduler run outcomes.",
	},
	[]string{"status"},
)

// ── WebSocket hub ───────────────────────────────────────────────────────

// WsConnectionsActive is a live gauge of subscribed clients.
var WsConnectionsActive = prometheus.NewGauge(
	prometheus.GaugeOpts{
		Name: "ws_connections_active",
		Help: "Active WebSocket connections to the price hub.",
	},
)

// WsMessagesSentTotal counts outbound messages — a coarse proxy for
// fan-out load.
var WsMessagesSentTotal = prometheus.NewCounter(
	prometheus.CounterOpts{
		Name: "ws_messages_sent_total",
		Help: "Total WebSocket messages pushed to clients.",
	},
)

// ── Upstream APIs ───────────────────────────────────────────────────────

// UpstreamErrorTotal counts errors from third-party APIs we depend on
// (Yahoo, Upstox, mfapi, NSE archives). Labels expose which feed misbehaved
// so alerts can be targeted.
var UpstreamErrorTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "upstream_error_total",
		Help: "Errors from upstream data providers.",
	},
	[]string{"provider", "kind"},
)

// init registers everything. We also register Go runtime + process
// collectors against the same registry so a single /metrics endpoint
// gives Grafana the full picture.
func init() {
	Registry.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		ApiRequestSeconds,
		TradeTotal,
		TradeFailedTotal,
		TradeExecuteSeconds,
		WalletMovementTotal,
		SipRunTotal,
		WsConnectionsActive,
		WsMessagesSentTotal,
		UpstreamErrorTotal,
	)
}

// Handler returns the /metrics HTTP handler.
func Handler() http.Handler {
	return promhttp.HandlerFor(Registry, promhttp.HandlerOpts{
		Registry:          Registry,
		EnableOpenMetrics: true,
	})
}

// HTTPMiddleware records latency + status class for every request. Route
// labels come from chi's RouteContext so we don't blow cardinality with
// dynamic IDs (`/portfolios/{id}` is one label, not one per UUID).
func HTTPMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		// Wrap so we can read the status code after the handler runs.
		ww := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(ww, r)

		// Pull the matched chi pattern (e.g. `/api/v1/portfolios/{id}`)
		// instead of the raw URL — keeps cardinality bounded.
		route := r.URL.Path
		if rc := chi.RouteContext(r.Context()); rc != nil && rc.RoutePattern() != "" {
			route = rc.RoutePattern()
		}
		ApiRequestSeconds.
			WithLabelValues(route, r.Method, statusClass(ww.status)).
			Observe(time.Since(start).Seconds())
	})
}

// statusClass collapses status codes into 2xx/3xx/4xx/5xx labels — gives
// histograms a useful "errors only" filter without exploding cardinality.
func statusClass(code int) string {
	if code == 0 {
		return "2xx"
	}
	return strconv.Itoa(code/100) + "xx"
}

// statusWriter captures the HTTP status code so the middleware can label
// the metric with a status_class. Default to 200 if WriteHeader is never
// called.
type statusWriter struct {
	http.ResponseWriter
	status int
}

func (sw *statusWriter) WriteHeader(code int) {
	sw.status = code
	sw.ResponseWriter.WriteHeader(code)
}
