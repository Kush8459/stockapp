import { useState } from "react";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
  Tooltip,
} from "recharts";
import {
  Briefcase,
  CalendarDays,
  Coins,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Trophy,
  Wallet2,
} from "lucide-react";
import { useDividendSummary } from "@/hooks/useDividends";
import { usePortfolioXirr } from "@/hooks/usePnl";
import { usePortfolioTimeseries } from "@/hooks/usePortfolioTimeseries";
import { useChartTheme } from "@/hooks/useChartTheme";
import { cn, formatCompact, formatCurrency, formatPercent, toNum } from "@/lib/utils";

interface PerformerSummary {
  ticker: string;
  pnl: number;
  pnlPct: number;
}

interface HoldingsHeroProps {
  portfolioId: string | undefined;
  invested: number;
  value: number;
  pnl: number;
  pnlPct: number;
  dayChange: number;
  dayChangePct: number;
  allocation: Array<{ name: string; value: number; color: string }>;
  best: PerformerSummary | null;
  worst: PerformerSummary | null;
  positionCount: number;
}

/**
 * The big "money tile" at the top of the Holdings page. Replaces the old
 * 8-cell totals card + side allocation chart with a single composition:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ ₹X.XXL  +/-day chip   ··· portfolio sparkline ···   donut    │
 *   │ Invested · P&L                                      legend   │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  [XIRR]  [Dividends FY]  [Best ↑]  [Worst ↓]                 │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Soft gradient backdrop, a subtle pulse on the day-change pill, and a
 * 6-month portfolio sparkline that resolves from the same time-series
 * endpoint the Benchmark chart uses (cached, cheap).
 */
export function HoldingsHero({
  portfolioId,
  invested,
  value,
  pnl,
  pnlPct,
  dayChange,
  dayChangePct,
  allocation,
  best,
  worst,
  positionCount,
}: HoldingsHeroProps) {
  const xirr = usePortfolioXirr(portfolioId);
  const dividends = useDividendSummary();
  const series = usePortfolioTimeseries(portfolioId, "6m");

  const sparkData = (series.data?.points ?? []).map((p) => ({
    t: p.time,
    v: toNum(p.value),
  }));
  const positive = pnl >= 0;
  const dayPositive = dayChange >= 0;

  const xirrPct =
    !xirr.isLoading && xirr.data?.rate != null && !xirr.data.insufficient
      ? xirr.data.rate * 100
      : null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
      className="card relative overflow-hidden p-0"
    >
      {/* Layered gradient backdrop. The cyan/violet wash + a faint conic
          ring give the card a "floating" quality that pure cards-on-cards
          lack. Both layers are decorative-only. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand/10 via-transparent to-violet-500/15"
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -right-32 -top-32 h-72 w-72 rounded-full blur-3xl",
          positive ? "bg-success/10" : "bg-danger/10",
        )}
      />

      <div className="relative grid grid-cols-1 gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        {/* ── Left: hero number + sparkline ────────────────────── */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-fg-muted">
                <Briefcase className="h-3 w-3" />
                Portfolio value
              </div>
              <div
                title={formatCurrency(value)}
                className="num mt-1 text-4xl font-semibold tracking-tight md:text-5xl"
              >
                {value >= 1e5 ? formatCompact(value) : formatCurrency(value)}
              </div>
              <div className="num mt-1 text-[12px] text-fg-muted">
                Invested {formatCurrency(invested)} ·{" "}
                <span className={cn(positive ? "pos" : "neg")}>
                  {positive ? "+" : ""}
                  {formatCurrency(pnl)} ({formatPercent(pnlPct)})
                </span>
              </div>
            </div>

            {/* Day-change pill — pulses on a state change so it feels live. */}
            <PulsePill
              positive={dayPositive}
              amount={dayChange}
              pct={dayChangePct}
            />
          </div>

          {/* Sparkline. 6 months of EOD portfolio value. */}
          <div className="relative h-20">
            {sparkData.length > 1 ? (
              <ResponsiveContainer>
                <AreaChart data={sparkData} margin={{ top: 4, bottom: 0, left: 0, right: 0 }}>
                  <defs>
                    <linearGradient id="hero-port-spark" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor={positive ? "#10b981" : "#ef4444"}
                        stopOpacity={0.4}
                      />
                      <stop
                        offset="100%"
                        stopColor={positive ? "#10b981" : "#ef4444"}
                        stopOpacity={0.02}
                      />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="v"
                    stroke={positive ? "#10b981" : "#ef4444"}
                    strokeWidth={2}
                    fill="url(#hero-port-spark)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center text-[11px] text-fg-subtle">
                <Sparkles className="mr-1.5 h-3 w-3" />
                Place a few trades to grow the timeline.
              </div>
            )}
          </div>
        </div>

        {/* ── Right: allocation donut + top legend ─────────────── */}
        <AllocationInset
          allocation={allocation}
          positionCount={positionCount}
        />
      </div>

      {/* ── Bottom strip: chip-style stats ────────────────────── */}
      <div className="relative grid grid-cols-2 gap-px border-t border-border/60 bg-border/40 sm:grid-cols-4">
        <ChipStat
          icon={TrendingUp}
          label="XIRR"
          value={xirrPct !== null ? formatPercent(xirrPct) : "—"}
          sub={
            xirr.data?.insufficient
              ? "more activity needed"
              : `${xirr.data?.flowCount ?? 0} flows`
          }
          tone={xirrPct !== null && xirrPct >= 0 ? "pos" : xirrPct !== null ? "neg" : undefined}
        />
        <ChipStat
          icon={Coins}
          label={`Dividends · ${dividends.data?.fyLabel ?? "FY"}`}
          value={formatCurrency(toNum(dividends.data?.financialYear))}
          sub={`${dividends.data?.count ?? 0} payouts · all-time ${formatCompact(toNum(dividends.data?.allTime))}`}
          tone="pos"
        />
        <ChipStat
          icon={Trophy}
          label="Best performer"
          value={best?.ticker ?? "—"}
          sub={
            best ? `${formatPercent(best.pnlPct)} · ${formatCurrency(best.pnl)}` : ""
          }
          tone="pos"
        />
        <ChipStat
          icon={TrendingDown}
          label="Worst performer"
          value={worst?.ticker ?? "—"}
          sub={
            worst ? `${formatPercent(worst.pnlPct)} · ${formatCurrency(worst.pnl)}` : ""
          }
          tone={worst && worst.pnlPct < 0 ? "neg" : undefined}
        />
      </div>
    </motion.section>
  );
}

// ── pulsing day-change pill ─────────────────────────────────────────────

function PulsePill({
  positive,
  amount,
  pct,
}: {
  positive: boolean;
  amount: number;
  pct: number;
}) {
  const Arrow = positive ? TrendingUp : TrendingDown;
  return (
    <motion.span
      key={`${positive}-${Math.round(amount)}`}
      initial={{ scale: 0.92, opacity: 0.4 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className={cn(
        "num inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold",
        positive
          ? "border-success/40 bg-success/10 text-success"
          : "border-danger/40 bg-danger/10 text-danger",
      )}
    >
      <Arrow className="h-3.5 w-3.5" />
      {positive ? "+" : ""}
      {formatCurrency(amount)}
      <span className="opacity-70">·</span>
      {formatPercent(pct)}
      <span className="text-[10px] font-normal opacity-70">today</span>
    </motion.span>
  );
}

// ── allocation donut + top-N legend ─────────────────────────────────────

function AllocationInset({
  allocation,
  positionCount,
}: {
  allocation: Array<{ name: string; value: number; color: string }>;
  positionCount: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const chartTheme = useChartTheme();
  const total = allocation.reduce((s, d) => s + d.value, 0);
  const top = allocation.slice(0, 5);
  const overflow = allocation.length - top.length;

  const activeSlice = active !== null ? allocation[active] : null;
  const centerLabel = activeSlice?.name ?? "Total";
  const centerValue = activeSlice?.value ?? total;

  return (
    <div className="flex flex-col items-center gap-3 lg:items-stretch">
      <div className="flex items-center justify-between gap-2 lg:hidden">
        <span className="label">Allocation</span>
        <span className="num text-[11px] text-fg-muted">
          {positionCount} positions
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative h-32 w-32 shrink-0">
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={allocation}
                dataKey="value"
                nameKey="name"
                innerRadius={42}
                outerRadius={62}
                paddingAngle={2}
                stroke={chartTheme.bg}
                strokeWidth={2}
                activeIndex={active ?? undefined}
                activeShape={renderActiveShape}
                onMouseEnter={(_, i) => setActive(i)}
                onMouseLeave={() => setActive(null)}
              >
                {allocation.map((d, i) => (
                  <Cell key={i} fill={d.color} />
                ))}
              </Pie>
              <Tooltip cursor={false} content={() => null} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-2">
            <div className="text-[9px] uppercase tracking-wider text-fg-subtle">
              {centerLabel}
            </div>
            <div className="num text-xs font-medium leading-tight">
              {formatCompact(centerValue)}
            </div>
          </div>
        </div>

        <ul className="min-w-0 flex-1 space-y-1">
          <li className="hidden items-center justify-between text-[11px] text-fg-subtle lg:flex">
            <span>Top holdings</span>
            <span className="num">{positionCount}</span>
          </li>
          {top.map((d, i) => (
            <li
              key={d.name}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              className="flex items-center justify-between gap-2 rounded text-[12px]"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: d.color }}
                />
                <span className="truncate">{d.name}</span>
              </span>
              <span className="num text-fg-muted">
                {((d.value / (total || 1)) * 100).toFixed(1)}%
              </span>
            </li>
          ))}
          {overflow > 0 && (
            <li className="num text-[10px] text-fg-subtle">
              +{overflow} more
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

function renderActiveShape(props: unknown) {
  const p = props as {
    cx: number;
    cy: number;
    innerRadius: number;
    outerRadius: number;
    startAngle: number;
    endAngle: number;
    fill: string;
  };
  return (
    <Sector
      cx={p.cx}
      cy={p.cy}
      innerRadius={p.innerRadius}
      outerRadius={p.outerRadius + 4}
      startAngle={p.startAngle}
      endAngle={p.endAngle}
      fill={p.fill}
    />
  );
}

// ── chip stats (bottom strip) ───────────────────────────────────────────

function ChipStat({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  tone?: "pos" | "neg";
}) {
  return (
    <div className="bg-bg-card/80 px-4 py-3 backdrop-blur transition-colors hover:bg-bg-card">
      <div className="flex items-center gap-2">
        <Icon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            tone === "pos" && "text-success",
            tone === "neg" && "text-danger",
            !tone && "text-fg-muted",
          )}
        />
        <span className="text-[10px] uppercase tracking-wider text-fg-muted">
          {label}
        </span>
      </div>
      <div
        className={cn(
          "num mt-1 truncate text-base font-semibold",
          tone === "pos" && "pos",
          tone === "neg" && "neg",
        )}
      >
        {value}
      </div>
      {sub && (
        <div className="num mt-0.5 truncate text-[10px] text-fg-subtle">
          {sub}
        </div>
      )}
    </div>
  );
}

// keep CalendarDays / Wallet2 / Sparkles imports used only by sub-versions
const _hide = { CalendarDays, Wallet2 };
void _hide;
