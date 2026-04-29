import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Loader2, TrendingUp } from "lucide-react";
import {
  usePortfolioTimeseries,
  type SeriesRange,
} from "@/hooks/usePortfolioTimeseries";
import { useCandles, type ChartRange } from "@/hooks/useCandles";
import { useChartTheme } from "@/hooks/useChartTheme";
import { cn, formatCurrency, formatPercent, toNum } from "@/lib/utils";

interface BenchmarkChartProps {
  portfolioId: string | undefined;
}

const benchmarks: Array<{ id: string; label: string; ticker: string }> = [
  { id: "nifty50", label: "NIFTY 50", ticker: "NIFTY50" },
  { id: "sensex", label: "SENSEX", ticker: "SENSEX" },
  { id: "banknifty", label: "BANK NIFTY", ticker: "BANKNIFTY" },
  { id: "niftyit", label: "NIFTY IT", ticker: "NIFTYIT" },
  { id: "niftymidcap", label: "NIFTY MIDCAP", ticker: "NIFTYMIDCAP" },
];

const ranges: Array<{ id: SeriesRange; label: string; candle: ChartRange }> = [
  { id: "1m", label: "1M", candle: "1m" },
  { id: "3m", label: "3M", candle: "3m" },
  { id: "6m", label: "6M", candle: "1y" }, // candle endpoint has no 6m, take 1y and clip
  { id: "1y", label: "1Y", candle: "1y" },
  { id: "5y", label: "5Y", candle: "5y" },
  { id: "all", label: "ALL", candle: "max" },
];

/**
 * Overlays the user's portfolio value series against an Indian-market index,
 * both normalized to 100 at the start of the visible window.
 *
 * Uses a portfolio replay built from the user's transactions (so cost basis
 * is exact) and EOD candle data for the benchmark. The "since" delta lets
 * users answer "did my picks beat the index?" at a glance.
 */
export function BenchmarkChart({ portfolioId }: BenchmarkChartProps) {
  const [range, setRange] = useState<SeriesRange>("1y");
  const [benchId, setBenchId] = useState(benchmarks[0].id);
  const benchmark = benchmarks.find((b) => b.id === benchId) ?? benchmarks[0];
  const candleRange = ranges.find((r) => r.id === range)?.candle ?? "1y";

  const portfolio = usePortfolioTimeseries(portfolioId, range);
  const candles = useCandles(benchmark.ticker, candleRange);
  const chartTheme = useChartTheme();

  const data = useMemo(() => {
    const pts = portfolio.data?.points ?? [];
    const bars = candles.data ?? [];
    if (pts.length === 0 || bars.length === 0) return [];
    // Index benchmark candles by YYYY-MM-DD for fast joins.
    const byDate = new Map<string, number>();
    for (const c of bars) {
      const d = new Date(c.time * 1000).toISOString().slice(0, 10);
      byDate.set(d, c.close);
    }
    // Normalize each series to 100 at the first emitted day where both
    // sources have values.
    const portStart = pts[0]?.value ? toNum(pts[0].value) : 0;
    let benchStart: number | null = null;
    const out: Array<{
      time: number;
      label: string;
      portfolio: number;
      benchmark: number | null;
      portValue: number;
      portInvested: number;
      benchPrice: number | null;
    }> = [];
    for (const p of pts) {
      const date = new Date(p.time * 1000).toISOString().slice(0, 10);
      const benchClose = byDate.get(date) ?? null;
      if (benchStart === null && benchClose !== null) {
        benchStart = benchClose;
      }
      const portValue = toNum(p.value);
      const portInvested = toNum(p.invested);
      const portNorm = portStart > 0 ? (portValue / portStart) * 100 : 100;
      const benchNorm =
        benchClose !== null && benchStart !== null && benchStart > 0
          ? (benchClose / benchStart) * 100
          : null;
      out.push({
        time: p.time,
        label: date,
        portfolio: round2(portNorm),
        benchmark: benchNorm !== null ? round2(benchNorm) : null,
        portValue,
        portInvested,
        benchPrice: benchClose,
      });
    }
    return out;
  }, [portfolio.data, candles.data]);

  const summary = useMemo(() => {
    if (data.length < 2) return null;
    const first = data[0];
    const last = data[data.length - 1];
    const portRet = first.portfolio > 0 ? last.portfolio - first.portfolio : 0;
    const benchRet =
      first.benchmark !== null && last.benchmark !== null
        ? last.benchmark - first.benchmark
        : null;
    const alpha = benchRet !== null ? portRet - benchRet : null;
    return { portRet, benchRet, alpha, last };
  }, [data]);

  const isLoading = portfolio.isLoading || candles.isLoading;
  const empty = !isLoading && data.length === 0;

  return (
    <section className="card p-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label flex items-center gap-2">
            <TrendingUp className="h-3.5 w-3.5" />
            Portfolio vs benchmark
          </div>
          <div className="text-xs text-fg-muted">
            Both series normalized to 100 at the start of the window.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={benchId}
            onChange={(e) => setBenchId(e.target.value)}
            className="input h-8 !py-1 px-2 text-xs"
            aria-label="Benchmark"
          >
            {benchmarks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-bg-soft p-0.5">
            {ranges.map((rng) => (
              <button
                key={rng.id}
                type="button"
                onClick={() => setRange(rng.id)}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                  range === rng.id
                    ? "bg-overlay/10 text-fg"
                    : "text-fg-muted hover:text-fg",
                )}
              >
                {rng.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Delta pills. Hide while loading or when there's nothing to compare. */}
      {summary && (
        <div className="mt-4 flex flex-wrap gap-2">
          <DeltaPill
            label="Your portfolio"
            value={summary.portRet}
            tone={summary.portRet >= 0 ? "pos" : "neg"}
          />
          {summary.benchRet !== null && (
            <DeltaPill
              label={benchmark.label}
              value={summary.benchRet}
              tone={summary.benchRet >= 0 ? "pos" : "neg"}
              muted
            />
          )}
          {summary.alpha !== null && (
            <DeltaPill
              label={`Alpha vs ${benchmark.label}`}
              value={summary.alpha}
              tone={summary.alpha >= 0 ? "pos" : "neg"}
              emphasized
            />
          )}
        </div>
      )}

      <div className="mt-4 h-64">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-fg-muted">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Replaying transactions…
          </div>
        ) : empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-sm">
            <span className="text-fg-muted">
              Nothing to compare yet — place a trade to seed the timeline.
            </span>
            <span className="text-[11px] text-fg-subtle">
              Charts populate from the date of your first transaction.
            </span>
          </div>
        ) : (
          <ResponsiveContainer>
            <AreaChart
              data={data}
              margin={{ top: 6, right: 8, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="bench-portfolio" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={chartTheme.border} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: chartTheme.fgSubtle, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                minTickGap={40}
                tickFormatter={(d: string) => {
                  const dt = new Date(d);
                  return dt.toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                  });
                }}
              />
              <YAxis
                tick={{ fill: chartTheme.fgSubtle, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `${v.toFixed(0)}`}
                domain={["auto", "auto"]}
                width={40}
              />
              <Tooltip
                contentStyle={{
                  background: chartTheme.bgSoft,
                  border: `1px solid ${chartTheme.border}`,
                  color: chartTheme.fg,
                  borderRadius: 8,
                  fontSize: 12,
                  padding: "8px 12px",
                }}
                labelFormatter={(d: string) =>
                  new Date(d).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })
                }
                formatter={(value: number, name: string, ctx) => {
                  if (name === "portfolio") {
                    const v = (ctx.payload as { portValue: number })?.portValue;
                    return [
                      `${value.toFixed(2)} (${formatCurrency(v ?? 0)})`,
                      "Portfolio",
                    ];
                  }
                  if (name === "benchmark") {
                    const v = (ctx.payload as { benchPrice: number | null })
                      ?.benchPrice;
                    return [
                      `${value.toFixed(2)}${v != null ? ` (${formatCurrency(v)})` : ""}`,
                      benchmark.label,
                    ];
                  }
                  return [value, name];
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                formatter={(v) =>
                  v === "portfolio" ? "Portfolio" : benchmark.label
                }
              />
              <Area
                type="monotone"
                dataKey="portfolio"
                stroke="#06b6d4"
                strokeWidth={2}
                fill="url(#bench-portfolio)"
              />
              <Area
                type="monotone"
                dataKey="benchmark"
                stroke="#a855f7"
                strokeWidth={1.6}
                strokeDasharray="4 3"
                fillOpacity={0}
                connectNulls
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

function DeltaPill({
  label,
  value,
  tone,
  muted,
  emphasized,
}: {
  label: string;
  value: number;
  tone: "pos" | "neg";
  muted?: boolean;
  emphasized?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-1.5",
        emphasized
          ? tone === "pos"
            ? "border-success/40 bg-success/10"
            : "border-danger/40 bg-danger/10"
          : "border-border bg-bg-soft/50",
      )}
    >
      <div
        className={cn(
          "text-[10px] uppercase tracking-wider",
          muted ? "text-fg-subtle" : "text-fg-muted",
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          "num text-sm font-semibold",
          tone === "pos" ? "pos" : "neg",
        )}
      >
        {formatPercent(value)}
      </div>
    </div>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Avoid unused-import warnings if recharts variant changes in future.
const _hide = { LineChart, Line };
void _hide;
