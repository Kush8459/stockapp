import { motion } from "framer-motion";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn, formatCompact, formatCurrency, formatPercent } from "@/lib/utils";

interface PnLCardProps {
  label: string;
  value: number;
  sub?: string;
  deltaPct?: number;
  tone?: "neutral" | "auto";
  compact?: boolean;
  index?: number;
}

export function PnLCard({
  label,
  value,
  sub,
  deltaPct,
  tone = "neutral",
  compact,
  index = 0,
}: PnLCardProps) {
  const positive = typeof deltaPct === "number" ? deltaPct >= 0 : value >= 0;
  const color =
    tone === "auto" ? (positive ? "text-success" : "text-danger") : "text-fg";
  const Arrow = positive ? TrendingUp : TrendingDown;

  // Auto-compact large numbers so they fit the card without overflow.
  // ₹2,29,217.30 (12 chars) becomes ₹2.29L (5 chars), but the full value
  // is in the title tooltip if the user wants precision.
  const fullText = formatCurrency(value);
  const display = compact || Math.abs(value) >= 1e5 ? formatCompact(value) : fullText;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: index * 0.05, ease: [0.2, 0.8, 0.2, 1] }}
      className="card flex flex-col overflow-hidden p-5"
    >
      {/* Label on its own row — never competes with the delta chip for space */}
      <span className="label">{label}</span>

      <div
        title={fullText}
        className={cn(
          "num mt-2 truncate text-2xl font-semibold tracking-tight xl:text-[26px]",
          color,
        )}
      >
        {display}
      </div>

      {/* Delta chip + sub line, both below the value */}
      {typeof deltaPct === "number" && (
        <div
          className={cn(
            "mt-2 inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium num",
            deltaPct >= 0
              ? "border-success/30 bg-success/10 text-success"
              : "border-danger/30 bg-danger/10 text-danger",
          )}
        >
          <Arrow className="h-3 w-3" />
          {formatPercent(deltaPct)}
        </div>
      )}
      {sub && <div className="num mt-1 truncate text-xs text-fg-muted">{sub}</div>}
    </motion.div>
  );
}
