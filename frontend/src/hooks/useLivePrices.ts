import { useEffect, useState } from "react";
import { useAuth } from "@/store/auth";
import { useAlertEvents, type AlertEvent } from "@/store/alertEvents";
import { useToast } from "@/components/Toaster";

export interface Quote {
  ticker: string;
  price: string;
  prevClose: string;
  changePct: string;
  updatedAt: string;
}

type WsEvent =
  | { type: "price"; data: Quote }
  | { type: "alert.triggered"; data: AlertEvent };

// ── module-level singleton ───────────────────────────────────────────────
//
// Every component that calls useLivePrices() shares one WebSocket. Without
// this, AppShell + Dashboard + Holdings + StockDetail + … each open their
// own connection, browsers log "WebSocket is closed before the connection
// is established" warnings, and the server re-runs its snapshot replay for
// every connection.
//
// Lifecycle: the hook attaches a listener and bumps a refcount. When the
// last listener detaches we delay the actual close by 1 s — long enough to
// absorb React StrictMode's mount → unmount → remount cycle in dev.
// ─────────────────────────────────────────────────────────────────────────

type Listener = (s: { quotes: Record<string, Quote>; connected: boolean }) => void;
type AlertListener = (a: AlertEvent) => void;

let priceState: Record<string, Quote> = {};
let connectedState = false;
const stateListeners = new Set<Listener>();
const alertListeners = new Set<AlertListener>();

// Coalescing buffer — every WS tick lands here, then we flush all of them
// to React state once per 100 ms. Keeps the UI at ~10 fps regardless of
// upstream tick rate, which matters when 500+ stocks tick simultaneously.
let pendingPrices: Record<string, Quote> = {};
let flushTimer: number | null = null;

function scheduleFlush() {
  if (flushTimer !== null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    if (Object.keys(pendingPrices).length === 0) return;
    priceState = { ...priceState, ...pendingPrices };
    pendingPrices = {};
    notifyState();
  }, 100);
}

let ws: WebSocket | null = null;
let currentToken: string | null = null;
let refCount = 0;
let closeTimer: number | null = null;

// Module-level dedupe — shared across hook mounts and tabs on the same
// account, so StrictMode's extra cycle can't double-toast an alert.
const seenAlerts = new Map<string, number>();
const SEEN_TTL_MS = 10 * 60 * 1000;
function hasSeenAlert(id: string): boolean {
  const now = Date.now();
  for (const [k, t] of seenAlerts) {
    if (now - t > SEEN_TTL_MS) seenAlerts.delete(k);
  }
  if (seenAlerts.has(id)) return true;
  seenAlerts.set(id, now);
  return false;
}

function notifyState() {
  const snapshot = { quotes: priceState, connected: connectedState };
  for (const l of stateListeners) l(snapshot);
}

function openSocket(token: string) {
  if (ws && currentToken === token && ws.readyState !== WebSocket.CLOSED) {
    return;
  }
  if (ws) {
    try { ws.close(); } catch { /* ignore */ }
  }

  const wsUrl = import.meta.env.VITE_WS_URL ?? "ws://localhost:8080";
  const conn = new WebSocket(`${wsUrl}/ws?token=${encodeURIComponent(token)}`);
  ws = conn;
  currentToken = token;

  conn.onopen = () => {
    if (ws !== conn) return;
    connectedState = true;
    notifyState();
  };
  conn.onclose = () => {
    if (ws !== conn) return;
    connectedState = false;
    notifyState();
    ws = null;
  };
  conn.onerror = () => {
    if (ws !== conn) return;
    connectedState = false;
    notifyState();
  };
  conn.onmessage = (ev) => {
    if (ws !== conn) return;
    try {
      const msg = JSON.parse(ev.data) as WsEvent;
      if (msg.type === "price") {
        // Buffer; flushed in batches every 100ms.
        pendingPrices[msg.data.ticker] = msg.data;
        scheduleFlush();
      } else if (msg.type === "alert.triggered") {
        if (hasSeenAlert(msg.data.alertId)) return;
        for (const l of alertListeners) l(msg.data);
      }
    } catch {
      /* ignore */
    }
  };
}

function attach(token: string) {
  if (closeTimer !== null) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  refCount++;
  openSocket(token);
}

function detach() {
  refCount--;
  if (refCount > 0) return;
  // Delay actual close so StrictMode's unmount-then-remount doesn't
  // tear down a perfectly good connection.
  closeTimer = window.setTimeout(() => {
    closeTimer = null;
    if (refCount === 0 && ws) {
      ws.close();
      ws = null;
      currentToken = null;
    }
  }, 1000);
}

/**
 * Subscribes to the backend's WebSocket. Multiple components calling this
 * hook share a single underlying connection. Price events update the
 * returned `quotes` map; alert.triggered events fire a toast and push into
 * the alert-event store.
 */
export function useLivePrices() {
  const token = useAuth((s) => s.accessToken);
  const [snapshot, setSnapshot] = useState({
    quotes: priceState,
    connected: connectedState,
  });
  const pushAlert = useAlertEvents((s) => s.push);
  const { push: pushToast } = useToast();

  useEffect(() => {
    if (!token) return;
    attach(token);

    const stateListener: Listener = (s) => setSnapshot(s);
    const alertListener: AlertListener = (a) => {
      pushAlert(a);
      const price = parseFloat(a.price);
      pushToast({
        kind: "alert",
        title: `${a.ticker} ${a.direction === "above" ? "crossed above" : "fell below"} your target`,
        description: `Now at ₹${price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`,
        durationMs: 8000,
      });
    };

    stateListeners.add(stateListener);
    alertListeners.add(alertListener);
    // Sync initial state in case the singleton was already populated by an
    // earlier hook caller before this component mounted.
    setSnapshot({ quotes: priceState, connected: connectedState });

    return () => {
      stateListeners.delete(stateListener);
      alertListeners.delete(alertListener);
      detach();
    };
    // pushAlert / pushToast are stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return snapshot;
}
