import { cn } from "@/lib/utils";
import type { ChartRange } from "@/hooks/useCandles";

const OPTIONS: Array<{ value: ChartRange; label: string }> = [
  { value: "1d", label: "1D" },
  { value: "1w", label: "1W" },
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
  { value: "1y", label: "1Y" },
  { value: "5y", label: "5Y" },
  { value: "max", label: "ALL" },
];

export function RangeSelector({
  value,
  onChange,
}: {
  value: ChartRange;
  onChange: (r: ChartRange) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-bg-soft p-0.5">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "num rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
            value === o.value
              ? "bg-white/10 text-fg"
              : "text-fg-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
