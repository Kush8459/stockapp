import { CalendarClock, Hand, Bell, Shuffle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TxnSource } from "@/lib/types";

const META: Record<
  TxnSource,
  { label: string; className: string; icon: LucideIcon }
> = {
  manual: {
    label: "Manual",
    className: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
    icon: Hand,
  },
  sip: {
    label: "SIP",
    className: "border-violet-500/30 bg-violet-500/10 text-violet-300",
    icon: CalendarClock,
  },
  alert: {
    label: "Alert",
    className: "border-warn/30 bg-warn/10 text-warn",
    icon: Bell,
  },
  rebalance: {
    label: "Rebalance",
    className: "border-fg-subtle/30 bg-overlay/5 text-fg-muted",
    icon: Shuffle,
  },
};

export function SourceChip({
  source,
  size = "sm",
  className,
}: {
  source: TxnSource;
  size?: "sm" | "md";
  className?: string;
}) {
  const m = META[source] ?? META.manual;
  const Icon = m.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium capitalize",
        m.className,
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
        className,
      )}
      title={`${m.label}-originated transaction`}
    >
      <Icon className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
      {m.label}
    </span>
  );
}
