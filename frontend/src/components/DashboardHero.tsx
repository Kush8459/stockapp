import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  Briefcase,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet2,
} from "lucide-react";
import { usePortfolioTimeseries } from "@/hooks/usePortfolioTimeseries";
import { useWallet } from "@/hooks/useWallet";
import { cn, formatCompact, formatCurrency, formatPercent, toNum } from "@/lib/utils";
import type { HoldingRow } from "./HoldingsTable";

interface DashboardHeroProps {
  portfolioId: string | undefined;
  invested: number;
  value: number;
  pnl: number;
  pnlPct: number;
  dayChange: number;
  dayChangePct: number;
  rows: HoldingRow[];
}

/**
 * The dashboard's headline tile. Replaces the row of five metric cards +
 * the allocation/movers row with a single composition:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │                                                              │
 *   │ NET WORTH                       [+₹X · +Y% today]            │
 *   │ ₹2.38L                                                       │
 *   │ ₹1L cash · ₹1.38L portfolio · invested ₹1.5L                 │
 *   │                                                              │
 *   │ ╲╱╲╱╲╱╲╱  6-month sparkline  ╲╱╲╱                            │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ Today's movers                                               │
 *   │ TCS      ┃   ████████████████  +₹890 (+1.8%)                 │
 *   │ RELIANCE ┃ ████████████        +₹620 (+0.9%)                 │
 *   │ ITC ████ ┃                     −₹120 (−0.4%)                 │
 *   │ WIPRO ██████████ ┃             −₹820 (−1.7%)                 │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Visual ideas at play:
 *   - "Mood ring" gradient backdrop — gradient stops shift between green
 *     and red based on the day-change percent, so the card looks happy on
 *     up days and bruised on down days even before reading the numbers.
 *   - Diverging race bars — instead of two stacked "gainers / losers" lists,
 *     we draw a centered axis with positive bars on the right and negative
 *     bars on the left. Bar length scales by today's ₹ contribution to P&L.
 *   - Portfolio sparkline pinned to the hero so the user gets a 6-month
 *     trend without scrolling to the benchmark chart.
 */
export function DashboardHero({
  portfolioId,
  invested,
  value,
  pnl,
  pnlPct,
  dayChange,
  dayChangePct,
  rows,
}: DashboardHeroProps) {
  const wallet = useWallet();
  const series = usePortfolioTimeseries(portfolioId, "6m");

  const cash = toNum(wallet.data?.balance);
  const netWorth = cash + value;
  const positive = pnl >= 0;
  const dayPositive = dayChange >= 0;

  // Day-mood is bounded ∈ [-1, 1] from a soft scaling of the % change. Used
  // to bias the gradient stops so colour matches sentiment without being
  // garish on small moves.
  const mood = clamp(dayChangePct / 1.5, -1, 1); // 1.5% → fully one side

  // Per-holding day contribution = (live − prev close) × qty.
  // We approximate by `value × dayChange% / 100` since rows already carry
  // the pre-computed day-change percent.
  const movers = useMemo(() => {
    const list = rows
      .map((r) => {
        const live = r.livePrice ?? toNum(r.currentPrice);
        const qty = toNum(r.quantity);
        const dayPct = toNum(r.dayChangePct);
        const value = qty * live;
        const contribution = value * (dayPct / 100);
        return { ticker: r.ticker, contribution, dayPct };
      })
      .filter((r) => Math.abs(r.contribution) > 0.5)
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
      .slice(0, 6);
    const max = list.reduce((m, r) => Math.max(m, Math.abs(r.contribution)), 0);
    return { list, max };
  }, [rows]);

  const sparkData = (series.data?.points ?? []).map((p) => ({
    t: p.time,
    v: toNum(p.value),
  }));

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
      className="card relative overflow-hidden p-0"
    >
      {/* Mood-ring backdrop. Two layered gradients morph with the day's
          sentiment — calm cyan/violet at neutral, vibrant green at strong
          green days, ember red on red days. Decorative-only. */}
      <MoodBackdrop mood={mood} />

      {/* ── Hero row ─────────────────────────────────────────── */}
      <div className="relative grid grid-cols-1 gap-4 p-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-fg-muted">
            <Briefcase className="h-3 w-3" />
            Net worth
          </div>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <div
              title={formatCurrency(netWorth)}
              className="num text-4xl font-semibold tracking-tight md:text-5xl"
            >
              {netWorth >= 1e5 ? formatCompact(netWorth) : formatCurrency(netWorth)}
            </div>
            <PulseChip
              positive={dayPositive}
              amount={dayChange}
              pct={dayChangePct}
            />
          </div>

          {/* Composition strip — cash / portfolio / invested. */}
          <CompositionStrip cash={cash} portfolio={value} invested={invested} />

          {/* Total P&L line — quiet, secondary. */}
          <div className="num text-[12px] text-fg-muted">
            Total{" "}
            <span className={positive ? "pos" : "neg"}>
              {positive ? "+" : ""}
              {formatCurrency(pnl)} ({formatPercent(pnlPct)})
            </span>{" "}
            since inception
          </div>
        </div>

        {/* Sparkline. */}
        <div className="relative h-24 lg:h-28">
          {sparkData.length > 1 ? (
            <ResponsiveContainer>
              <AreaChart data={sparkData} margin={{ top: 6, bottom: 0, left: 0, right: 0 }}>
                <defs>
                  <linearGradient id="hero-sparkfill" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor={positive ? "#10b981" : "#ef4444"}
                      stopOpacity={0.45}
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
                  strokeWidth={2.2}
                  fill="url(#hero-sparkfill)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-[11px] text-fg-subtle">
              <Sparkles className="mr-1.5 h-3 w-3" />
              Trade to seed the timeline.
            </div>
          )}
        </div>
      </div>

      {/* ── Movers strip (diverging bars) ────────────────────── */}
      <div className="relative border-t border-border/60 bg-bg-card/50 p-5 backdrop-blur">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-fg-muted">
            <TrendingUp className="h-3 w-3" />
            Today's movers
          </div>
          <span className="num text-[10px] text-fg-subtle">
            {movers.list.length} of {rows.length} positions
          </span>
        </div>

        {movers.list.length === 0 ? (
          <p className="text-sm text-fg-muted">
            Quiet day — no meaningful movement across your positions yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {movers.list.map((m) => (
              <DivergingBar key={m.ticker} mover={m} max={movers.max} />
            ))}
          </ul>
        )}
      </div>
    </motion.section>
  );
}

// ── Mood backdrop ───────────────────────────────────────────────────────

function MoodBackdrop({ mood }: { mood: number }) {
  // Color stops shift toward green (mood>0) or red (mood<0). Magnitude
  // controls saturation — flat days stay calm, big moves get vibrant.
  const intensity = Math.abs(mood);
  const tintFrom =
    mood >= 0
      ? `rgba(16, 185, 129, ${(0.10 + intensity * 0.12).toFixed(2)})`
      : `rgba(239, 68, 68, ${(0.08 + intensity * 0.12).toFixed(2)})`;
  const tintTo =
    mood >= 0
      ? `rgba(6, 182, 212, ${(0.05 + intensity * 0.05).toFixed(2)})`
      : `rgba(245, 158, 11, ${(0.04 + intensity * 0.06).toFixed(2)})`;

  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-[background] duration-500"
        style={{
          backgroundImage: `linear-gradient(135deg, ${tintFrom} 0%, ${tintTo} 60%, transparent 100%)`,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 -top-32 h-72 w-72 rounded-full blur-3xl transition-[background] duration-500"
        style={{
          background:
            mood >= 0
              ? `rgba(16, 185, 129, ${(0.08 + intensity * 0.10).toFixed(2)})`
              : `rgba(239, 68, 68, ${(0.08 + intensity * 0.10).toFixed(2)})`,
        }}
      />
    </>
  );
}

// ── Day-change pulse pill ───────────────────────────────────────────────

function PulseChip({
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

// ── Composition strip (cash · portfolio · invested) ─────────────────────

function CompositionStrip({
  cash,
  portfolio,
  invested,
}: {
  cash: number;
  portfolio: number;
  invested: number;
}) {
  const total = cash + portfolio || 1;
  const cashPct = (cash / total) * 100;
  return (
    <div className="space-y-1.5">
      {/* Bar showing the cash/portfolio split. 100% width across both. */}
      <div className="h-1.5 w-full overflow-hidden rounded-full border border-border/60">
        <div
          className="h-full bg-gradient-to-r from-brand to-violet-500"
          style={{ width: `${cashPct}%` }}
          aria-label="Cash share"
        />
      </div>
      <div className="num flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-fg-muted">
        <span className="inline-flex items-center gap-1">
          <Wallet2 className="h-3 w-3 text-brand" /> {formatCurrency(cash)} cash
        </span>
        <span>·</span>
        <span>{formatCurrency(portfolio)} portfolio</span>
        <span>·</span>
        <span>{formatCurrency(invested)} invested</span>
      </div>
    </div>
  );
}

// ── Diverging race bar ──────────────────────────────────────────────────

function DivergingBar({
  mover,
  max,
}: {
  mover: { ticker: string; contribution: number; dayPct: number };
  max: number;
}) {
  const positive = mover.contribution >= 0;
  const widthPct = max > 0 ? (Math.abs(mover.contribution) / max) * 100 : 0;
  const Arrow = positive ? ArrowUpRight : ArrowDownRight;

  return (
    <li className="grid grid-cols-[80px_minmax(0,1fr)_120px] items-center gap-3 text-[12px]">
      <span className="num truncate font-medium">{mover.ticker}</span>

      {/* Bar with center axis. Positive grows right; negative grows left. */}
      <div className="relative h-2.5 w-full">
        <div
          aria-hidden
          className="absolute inset-y-0 left-1/2 w-px bg-border"
        />
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${widthPct / 2}%` }}
          transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
          className={cn(
            "absolute top-1/2 h-2 -translate-y-1/2 rounded-full",
            positive
              ? "left-1/2 bg-gradient-to-r from-success/60 to-success"
              : "right-1/2 bg-gradient-to-l from-danger/60 to-danger",
          )}
          style={{ width: `${widthPct / 2}%` }}
        />
      </div>

      <span
        className={cn(
          "num inline-flex items-center justify-end gap-1 text-right tabular-nums",
          positive ? "pos" : "neg",
        )}
      >
        <Arrow className="h-3 w-3" />
        {positive ? "+" : ""}
        {formatCurrency(mover.contribution)}
        <span className="text-[10px] opacity-70">({formatPercent(mover.dayPct)})</span>
      </span>
    </li>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
