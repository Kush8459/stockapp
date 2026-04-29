import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, WifiOff } from "lucide-react";
import { useLivePrices } from "@/hooks/useLivePrices";

const VISIBLE_THRESHOLD_MS = 5_000;

/**
 * Surfaces a top banner when the live-prices WebSocket has been down for
 * more than 5 seconds. Below that threshold we stay silent — most disconnects
 * are sub-second blips during HMR / network hiccups and a flashing banner
 * would be more annoying than informative.
 *
 * On every successful reconnect we invalidate the alerts query so any
 * `alert.triggered` events that fired during the outage surface in the
 * normal toast flow next time the user opens the alerts page.
 */
export function ConnectionBanner() {
  const { connected, downSince, reconnects } = useLivePrices();
  const qc = useQueryClient();
  const [, setTick] = useState(0);

  // Re-render once a second so the "down for X" copy stays current. The
  // interval only runs while disconnected — no idle ticks when we're up.
  useEffect(() => {
    if (connected || downSince === null) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [connected, downSince]);

  // On reconnect: refetch state that may have been missed during the
  // outage. Alerts are the highest-value (a missed trigger means a missed
  // toast); we also refetch holdings + summary in case a SIP fired.
  useEffect(() => {
    if (reconnects === 0) return;
    qc.invalidateQueries({ queryKey: ["alerts"] });
    qc.invalidateQueries({ queryKey: ["alert-events"] });
    qc.invalidateQueries({ queryKey: ["holdings"] });
    qc.invalidateQueries({ queryKey: ["summary"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
  }, [reconnects, qc]);

  if (connected || downSince === null) return null;
  const downMs = Date.now() - downSince;
  if (downMs < VISIBLE_THRESHOLD_MS) return null;

  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn"
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">
        Live prices disconnected — reconnecting…
      </span>
      <span className="num text-[11px] text-warn/80">
        {formatDuration(downMs)}
      </span>
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
    </div>
  );
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}
