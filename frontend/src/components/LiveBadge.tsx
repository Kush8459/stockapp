import { Radio } from "lucide-react";
import { useMarketStatus } from "@/hooks/useMarketStatus";
import { cn } from "@/lib/utils";

interface LiveBadgeProps {
  /** Is our WebSocket to the backend currently up? */
  connected: boolean;
  /**
   * Whether this view actually has a quote for the ticker. Used by the
   * stock-detail page to show "Historical" when the search returned a
   * ticker we don't stream. Defaults to true (dashboard / holdings always
   * have something cached).
   */
  hasQuote?: boolean;
  /** Tooltip override; defaults to a stitched-together status string. */
  title?: string;
}

/**
 * Small chip showing whether prices are flowing in real-time. Reflects
 * market-status truth, not just WS connection — so "Live" never lies during
 * off-hours.
 */
export function LiveBadge({ connected, hasQuote = true, title }: LiveBadgeProps) {
  const { data: status } = useMarketStatus();

  let label = "—";
  let tone: "live" | "preopen" | "closed" | "offline" | "historical" = "offline";
  let pulse = false;

  if (!connected) {
    label = "Offline";
    tone = "offline";
  } else if (!hasQuote) {
    label = "Historical";
    tone = "historical";
  } else if (status?.status === "open") {
    label = "Live";
    tone = "live";
    pulse = true;
  } else if (status?.status === "preopen") {
    label = "Pre-open";
    tone = "preopen";
    pulse = true;
  } else if (status?.status === "holiday") {
    label = "Holiday";
    tone = "closed";
  } else if (status?.status === "weekend") {
    label = "Weekend";
    tone = "closed";
  } else {
    label = "Closed";
    tone = "closed";
  }

  return (
    <span
      className={cn("chip", toneClass(tone))}
      title={
        title ??
        (status?.label ? `${label} · ${status.label}` : label)
      }
    >
      <Radio className={cn("h-3 w-3", pulse && "animate-pulse")} />
      {label}
    </span>
  );
}

function toneClass(t: "live" | "preopen" | "closed" | "offline" | "historical"): string {
  switch (t) {
    case "live":
      return "border-success/30 text-success";
    case "preopen":
      return "border-warn/30 text-warn";
    case "closed":
      return "border-border text-fg-muted";
    case "historical":
      return "border-border text-fg-muted";
    case "offline":
    default:
      return "border-border text-fg-subtle";
  }
}
