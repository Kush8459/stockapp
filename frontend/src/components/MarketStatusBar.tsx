import { useEffect, useState } from "react";
import { CircleDot } from "lucide-react";
import { useMarketStatus, type MarketStatus, type MarketSnapshot } from "@/hooks/useMarketStatus";
import { cn } from "@/lib/utils";

/**
 * Compact market status next to the search bar. Shows just the headline
 * status + a live IST clock — full detail (next session, holiday name)
 * is in the tooltip.
 */
export function MarketStatusBar() {
  const { data: status } = useMarketStatus();
  const nowIST = useNowIST();

  if (!status) {
    return (
      <div className="flex h-10 shrink-0 items-center rounded-lg border border-border/60 bg-bg-soft/50 px-3 text-xs text-fg-subtle">
        Loading…
      </div>
    );
  }

  const tone = toneFor(status.status);

  return (
    <div
      title={tooltipFor(status)}
      className={cn(
        "flex h-10 shrink-0 items-center gap-2 rounded-lg border bg-bg-soft/50 px-3",
        tone.border,
      )}
    >
      <CircleDot
        className={cn(
          "h-3 w-3 shrink-0",
          tone.icon,
          status.status === "open" && "animate-pulse",
        )}
      />
      <span className={cn("text-sm font-medium", tone.text)}>
        {shortLabel(status)}
      </span>
      <span className="text-fg-subtle">·</span>
      <span className="num text-xs text-fg-muted">{nowIST}</span>
    </div>
  );
}

function toneFor(s: MarketStatus): { border: string; text: string; icon: string } {
  switch (s) {
    case "open":
      return { border: "border-success/40", text: "text-success", icon: "text-success" };
    case "preopen":
      return { border: "border-warn/40", text: "text-warn", icon: "text-warn" };
    case "holiday":
      return {
        border: "border-violet-500/40",
        text: "text-violet-300",
        icon: "text-violet-300",
      };
    case "weekend":
    case "closed":
    default:
      return { border: "border-border", text: "text-fg-muted", icon: "text-fg-subtle" };
  }
}

// One-word headline. The full "Next session" / holiday name lives in the
// tooltip so the bar stays compact.
function shortLabel(s: MarketSnapshot): string {
  switch (s.status) {
    case "open":
      return "Open";
    case "preopen":
      return "Pre-open";
    case "holiday":
      return "Holiday";
    case "weekend":
      return "Weekend";
    case "closed":
    default:
      return "Closed";
  }
}

function tooltipFor(s: MarketSnapshot): string {
  let line = s.label;
  if (s.holidayName) line += ` (${s.holidayName})`;
  if (s.nextOpen) {
    line += ` — next session ${formatLongIST(s.nextOpen)}`;
  }
  return line;
}

function formatLongIST(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
}

function useNowIST(): string {
  const [now, setNow] = useState(() => formatNow());
  useEffect(() => {
    const id = window.setInterval(() => setNow(formatNow()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function formatNow(): string {
  return new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
}
