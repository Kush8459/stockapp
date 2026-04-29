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

export interface LiveSnapshot {
  quotes: Record<string, Quote>;
  connected: boolean;
  /** ms epoch when the connection went down. null while connected. */
  downSince: number | null;
  /**
   * Increments on every successful (re)open after a prior disconnect. Useful
   * as a `useEffect` dep to refetch state that may have been missed during
   * the outage (e.g. /alerts to reconcile triggers).
   */
  reconnects: number;
}

type Listener = (s: LiveSnapshot) => void;
type AlertListener = (a: AlertEvent) => void;

let priceState: Record<string, Quote> = {};
let connectedState = false;
let downSince: number | null = null;
let reconnects = 0;
let reconnectAttempts = 0;
let backoffTimer: number | null = null;
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
  const snapshot: LiveSnapshot = {
    quotes: priceState,
    connected: connectedState,
    downSince,
    reconnects,
  };
  for (const l of stateListeners) l(snapshot);
}

// scheduleReconnect kicks off an exponential backoff retry chain when the
// socket drops while listeners are still attached. 1s, 2s, 4s, 8s, 16s,
// 30s cap. Resets to 1s once a fresh `onopen` fires.
function scheduleReconnect() {
  if (backoffTimer !== null) return;
  if (refCount === 0 || !currentToken) return;
  const delay = Math.min(30_000, 1000 * Math.pow(2, reconnectAttempts));
  backoffTimer = window.setTimeout(() => {
    backoffTimer = null;
    reconnectAttempts++;
    if (refCount > 0 && currentToken) openSocket(currentToken);
  }, delay);
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
    const wasDown = downSince !== null;
    connectedState = true;
    downSince = null;
    reconnectAttempts = 0;
    if (wasDown) reconnects++;
    notifyState();
  };
  conn.onclose = () => {
    if (ws !== conn) return;
    if (connectedState) downSince = Date.now();
    connectedState = false;
    notifyState();
    ws = null;
    scheduleReconnect();
  };
  conn.onerror = () => {
    if (ws !== conn) return;
    if (connectedState) downSince = Date.now();
    connectedState = false;
    notifyState();
    // onclose fires next; that's where the reconnect schedule kicks in.
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
    if (refCount === 0) {
      // No more listeners — also stop any pending reconnect attempt so
      // a hidden tab doesn't keep reconnecting forever.
      if (backoffTimer !== null) {
        clearTimeout(backoffTimer);
        backoffTimer = null;
      }
      if (ws) {
        ws.close();
        ws = null;
      }
      currentToken = null;
      reconnectAttempts = 0;
      downSince = null;
    }
  }, 1000);
}

/**
 * Subscribes to the backend's WebSocket. Multiple components calling this
 * hook share a single underlying connection. Price events update the
 * returned `quotes` map; alert.triggered events fire a toast and push into
 * the alert-event store.
 */
export function useLivePrices(): LiveSnapshot {
  const token = useAuth((s) => s.accessToken);
  const [snapshot, setSnapshot] = useState<LiveSnapshot>({
    quotes: priceState,
    connected: connectedState,
    downSince,
    reconnects,
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
    setSnapshot({
      quotes: priceState,
      connected: connectedState,
      downSince,
      reconnects,
    });

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
