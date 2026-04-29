import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
} from "recharts";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  Building2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useCandles } from "@/hooks/useCandles";
import { useFundamentals } from "@/hooks/useFundamentals";
import { LiveBadge } from "./LiveBadge";
import { WatchlistPopover } from "./WatchlistPopover";
import { cn, formatCompact, formatCurrency, formatPercent, toNum } from "@/lib/utils";
import type { Holding } from "@/lib/types";

interface StockHeroProps {
  ticker: string;
  livePrice: number;
  dayChangePct: number;
  hasLiveStream: boolean;
  priceAsOf: string | null;
  connected: boolean;
  holding?: Holding;
  onBuy: () => void;
  onSell: () => void;
  onAlert: () => void;
}

/**
 * Bloomberg-terminal-style ribbon for the StockDetail page. Replaces the
 * old "label · price · chip · LiveBadge" header row with a single layered
 * composition:
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ [intraday sparkline as soft backdrop]                            │
 *   │                                                                  │
 *   │ STOCK · Auto                                                     │
 *   │ TATAMOTORS                ₹923.45  [↑ +2.3% today]  [LiveBadge]  │
 *   │ Auto manufacturers                                  [♥ Watch]    │
 *   │                                                                  │
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │ DAY  ₹918 ─●──── ₹931      52-WK  ₹680 ─────●──── ₹980           │
 *   │ Mkt Cap ₹3.4LCr · PE 18.5 · Vol 3.2M · Beta 1.2 · Yield 1.4%     │
 *   │                                                                  │
 *   │ [↓ Buy] [↑ Sell] [🔔 Alert]                                      │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Visual notes:
 *   - Intraday 1d candle data forms a low-opacity sparkline that fills the
 *     full width behind the title — gives the page a "feed" feel without
 *     competing with the dedicated price chart below.
 *   - The price flashes green (up) or red (down) for ~700ms on every tick,
 *     so users see the live update even when reading another part of the
 *     page.
 *   - Day-range and 52-week-range bars with marker dots tell users where
 *     today's price sits in two timeframes at a glance.
 */
export function StockHero({
  ticker,
  livePrice,
  dayChangePct,
  hasLiveStream,
  priceAsOf,
  connected,
  holding,
  onBuy,
  onSell,
  onAlert,
}: StockHeroProps) {
  const fundamentals = useFundamentals(ticker);
  // 1d candles drive both the sparkline and the day's true high/low. We
  // keep this query independent of the main chart's range selector so the
  // hero never goes blank when the user changes the chart timeframe.
  const intraday = useCandles(ticker, "1d");

  // Tick-flash state: pulse the price green or red briefly on every change.
  const prevPrice = useRef<number>(livePrice);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (livePrice === prevPrice.current) return;
    setFlash(livePrice > prevPrice.current ? "up" : "down");
    prevPrice.current = livePrice;
    const id = window.setTimeout(() => setFlash(null), 700);
    return () => window.clearTimeout(id);
  }, [livePrice]);

  // Day high/low from the intraday bars; falls back to the 52w range from
  // fundamentals if the day candles are still loading.
  const dayRange = useMemo(() => {
    const bars = intraday.data ?? [];
    if (bars.length === 0) return null;
    let lo = bars[0].low;
    let hi = bars[0].high;
    for (const c of bars) {
      if (c.low < lo) lo = c.low;
      if (c.high > hi) hi = c.high;
    }
    return { low: lo, high: hi };
  }, [intraday.data]);

  const fifty2 =
    fundamentals.data?.fiftyTwoWeekLow != null &&
    fundamentals.data?.fiftyTwoWeekHigh != null
      ? {
          low: fundamentals.data.fiftyTwoWeekLow,
          high: fundamentals.data.fiftyTwoWeekHigh,
        }
      : null;

  const f = fundamentals.data;
  const positive = dayChangePct >= 0;
  const Arrow = positive ? TrendingUp : TrendingDown;
  const sparkData = (intraday.data ?? []).map((c) => ({
    t: c.time,
    v: c.close,
  }));

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
      className="card relative overflow-hidden p-0"
    >
      {/* Intraday sparkline as soft backdrop. Sits behind the title text;
          non-interactive. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-40 opacity-[0.45]"
      >
        {sparkData.length > 1 && (
          <ResponsiveContainer>
            <AreaChart data={sparkData} margin={{ top: 0, bottom: 0, left: 0, right: 0 }}>
              <defs>
                <linearGradient id="hero-stock-spark" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor={positive ? "#10b981" : "#ef4444"}
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="100%"
                    stopColor={positive ? "#10b981" : "#ef4444"}
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="v"
                stroke={positive ? "#10b981" : "#ef4444"}
                strokeWidth={1.5}
                fill="url(#hero-stock-spark)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -right-32 -top-24 h-72 w-72 rounded-full blur-3xl",
          positive ? "bg-success/10" : "bg-danger/10",
        )}
      />

      {/* ── Headline row: ticker + price + chips ─────────────── */}
      <div className="relative grid grid-cols-1 gap-4 p-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-fg-muted">
            <span>{holding?.assetType ?? "stock"}</span>
            {f?.sector && (
              <>
                <span className="text-fg-subtle">·</span>
                <span className="chip text-[10px] normal-case tracking-normal">
                  <Building2 className="h-2.5 w-2.5" />
                  {f.sector}
                </span>
              </>
            )}
          </div>
          <h1 className="num mt-1 text-3xl font-semibold tracking-tight md:text-4xl">
            {ticker}
          </h1>
          {f?.industry && (
            <div className="mt-0.5 truncate text-xs text-fg-muted">
              {f.industry}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-end justify-end gap-3">
          <div className="text-right">
            <div className="num text-[10px] uppercase tracking-wider text-fg-muted">
              Price
            </div>
            <motion.div
              key={`${flash}-${livePrice}`}
              initial={
                flash
                  ? { color: flash === "up" ? "#10b981" : "#ef4444" }
                  : false
              }
              animate={{
                color: flash
                  ? flash === "up"
                    ? "#10b981"
                    : "#ef4444"
                  : "currentColor",
              }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              className="num text-3xl font-semibold tracking-tight md:text-4xl"
              title={formatCurrency(livePrice)}
            >
              {livePrice >= 1e5 ? formatCompact(livePrice) : formatCurrency(livePrice)}
            </motion.div>
            {priceAsOf && (
              <div className="num text-[10px] text-fg-subtle">
                {hasLiveStream ? "real-time" : `as of ${priceAsOf}`}
              </div>
            )}
          </div>

          <PulsePill positive={positive} pct={dayChangePct} Arrow={Arrow} />

          <div className="flex items-center gap-1.5">
            <LiveBadge connected={connected} hasQuote={hasLiveStream} />
            <WatchlistPopover ticker={ticker} assetType={holding?.assetType} />
          </div>
        </div>
      </div>

      {/* ── Range bars row ───────────────────────────────────── */}
      <div className="relative grid grid-cols-1 gap-4 border-t border-border/60 bg-bg-card/60 p-5 backdrop-blur md:grid-cols-2">
        {dayRange ? (
          <RangeBar
            label="Day range"
            low={dayRange.low}
            high={dayRange.high}
            current={livePrice}
          />
        ) : (
          <RangeBar.Placeholder label="Day range" />
        )}
        {fifty2 ? (
          <RangeBar
            label="52-week range"
            low={fifty2.low}
            high={fifty2.high}
            current={livePrice}
          />
        ) : (
          <RangeBar.Placeholder label="52-week range" />
        )}
      </div>

      {/* ── Stats strip ─────────────────────────────────────── */}
      <div className="relative grid grid-cols-2 gap-px border-t border-border/60 bg-border/40 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Mkt cap"
          value={
            f?.marketCap
              ? `${formatCompact(f.marketCap).replace("₹", "₹")}`
              : "—"
          }
        />
        <Stat
          label="P/E"
          value={f?.trailingPE ? f.trailingPE.toFixed(1) : "—"}
        />
        <Stat
          label="EPS"
          value={f?.eps ? formatCurrency(f.eps) : "—"}
        />
        <Stat
          label="Beta"
          value={f?.beta ? f.beta.toFixed(2) : "—"}
        />
        <Stat
          label="Avg vol"
          value={f?.averageVolume ? formatCompact(f.averageVolume).replace("₹", "") : "—"}
        />
        <Stat
          label="Div yield"
          value={
            f?.dividendYield != null
              ? `${(f.dividendYield * 100).toFixed(2)}%`
              : "—"
          }
        />
      </div>

      {/* ── Action row ──────────────────────────────────────── */}
      <div className="relative flex flex-wrap items-center gap-2 border-t border-border/60 p-4">
        <button type="button" onClick={onBuy} className="btn-primary text-xs">
          <ArrowDownLeft className="h-3.5 w-3.5" /> Buy
        </button>
        <button
          type="button"
          onClick={onSell}
          disabled={!holding || toNum(holding?.quantity) <= 0}
          className="btn-outline text-xs"
        >
          <ArrowUpRight className="h-3.5 w-3.5" /> Sell
        </button>
        <button type="button" onClick={onAlert} className="btn-outline text-xs">
          <Bell className="h-3.5 w-3.5" /> Set alert
        </button>
      </div>
    </motion.section>
  );
}

// ── Day-change pulse pill ───────────────────────────────────────────────

function PulsePill({
  positive,
  pct,
  Arrow,
}: {
  positive: boolean;
  pct: number;
  Arrow: React.ComponentType<{ className?: string }>;
}) {
  return (
    <motion.span
      key={`${positive}-${Math.round(pct * 100)}`}
      initial={{ scale: 0.94, opacity: 0.5 }}
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
      {formatPercent(pct)}
      <span className="text-[10px] font-normal opacity-70">today</span>
    </motion.span>
  );
}

// ── RangeBar: low ──●── high ────────────────────────────────────────────

function RangeBar({
  label,
  low,
  high,
  current,
}: {
  label: string;
  low: number;
  high: number;
  current: number;
}) {
  const span = Math.max(0, high - low);
  const pct = span > 0 ? Math.max(0, Math.min(1, (current - low) / span)) : 0.5;
  const distFromHigh = span > 0 ? ((high - current) / span) * 100 : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-fg-muted">
        <span>{label}</span>
        <span className="num text-fg-subtle">
          {distFromHigh > 0
            ? `${distFromHigh.toFixed(1)}% from high`
            : "at high"}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-overlay/[0.08]">
        <div
          className="absolute inset-y-0 rounded-full bg-gradient-to-r from-danger/40 via-warn/40 to-success/40"
          style={{ left: 0, right: 0 }}
        />
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg-card bg-fg shadow-glow"
          style={{ left: `${(pct * 100).toFixed(2)}%` }}
        />
      </div>
      <div className="num mt-1 flex justify-between text-[11px] text-fg-muted">
        <span>{formatCurrency(low)}</span>
        <span className="text-fg">{formatCurrency(current)}</span>
        <span>{formatCurrency(high)}</span>
      </div>
    </div>
  );
}

RangeBar.Placeholder = function RangeBarPlaceholder({ label }: { label: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-fg-muted">{label}</div>
      <div className="num mt-1 text-[11px] text-fg-subtle">No data yet…</div>
    </div>
  );
};

// ── Single stat cell ────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-card/80 px-4 py-3 backdrop-blur transition-colors hover:bg-bg-card">
      <div className="text-[10px] uppercase tracking-wider text-fg-muted">
        {label}
      </div>
      <div className="num mt-0.5 truncate text-sm font-semibold">{value}</div>
    </div>
  );
}
