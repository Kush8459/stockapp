import { Activity, ShieldAlert, ArrowDownRight, ArrowUpRight, Loader2, Repeat } from "lucide-react";
import type { MfMetrics } from "@/hooks/useMfCatalog";
import { cn, formatCurrency, toNum } from "@/lib/utils";

interface MfMetricsCardProps {
  metrics: MfMetrics | undefined;
  loading: boolean;
}

export function MfMetricsCard({ metrics, loading }: MfMetricsCardProps) {
  return (
    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="label">Risk &amp; performance</div>
          <div className="text-xs text-fg-muted">
            Computed from daily NAV history. RFR 7% (10y G-sec proxy).
          </div>
        </div>
        {metrics && metrics.navPointCount > 0 && (
          <div className="text-[11px] text-fg-subtle">
            {metrics.navPointCount.toLocaleString()} NAV points · {metrics.historyDays.toLocaleString()} days
          </div>
        )}
      </div>

      {loading && !metrics ? (
        <div className="flex h-24 items-center justify-center text-sm text-fg-muted">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> computing metrics…
        </div>
      ) : !metrics || metrics.navPointCount < 30 ? (
        <p className="text-sm text-fg-muted">
          Not enough NAV history yet to compute risk metrics. Come back once
          the fund has a few months of public NAVs.
        </p>
      ) : (
        <>
          {/* Top-line: 4 KPIs */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi
              icon={<Activity className="h-3.5 w-3.5" />}
              label="Volatility"
              value={
                metrics.volatility !== undefined
                  ? `${metrics.volatility.toFixed(2)}%`
                  : "—"
              }
              hint="Annualised, σ × √252"
            />
            <Kpi
              icon={<Repeat className="h-3.5 w-3.5" />}
              label="Sharpe ratio"
              value={
                metrics.sharpeRatio !== undefined
                  ? metrics.sharpeRatio.toFixed(2)
                  : "—"
              }
              hint={`(return − ${(metrics.riskFreeRate * 100).toFixed(0)}%) / σ`}
              tone={
                metrics.sharpeRatio === undefined
                  ? undefined
                  : metrics.sharpeRatio >= 1
                    ? "pos"
                    : metrics.sharpeRatio < 0
                      ? "neg"
                      : undefined
              }
            />
            <Kpi
              icon={<ShieldAlert className="h-3.5 w-3.5" />}
              label="Max drawdown"
              value={
                metrics.maxDrawdown
                  ? `−${metrics.maxDrawdown.percentDecline.toFixed(2)}%`
                  : "—"
              }
              hint={
                metrics.maxDrawdown
                  ? `${metrics.maxDrawdown.durationDays.toLocaleString()}d peak→trough`
                  : undefined
              }
              tone="neg"
            />
            <Kpi
              icon={<ArrowUpRight className="h-3.5 w-3.5" />}
              label="Up months"
              value={
                metrics.upMonthsPct !== undefined
                  ? `${metrics.upMonthsPct.toFixed(0)}%`
                  : "—"
              }
              hint={
                metrics.downMonthsPct !== undefined
                  ? `${metrics.downMonthsPct.toFixed(0)}% down`
                  : undefined
              }
              tone={
                metrics.upMonthsPct !== undefined && metrics.upMonthsPct >= 60
                  ? "pos"
                  : undefined
              }
            />
          </div>

          {/* Calendar year returns */}
          {metrics.yearlyReturns && metrics.yearlyReturns.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <div className="label">Calendar year returns</div>
                {metrics.bestYear && metrics.worstYear && (
                  <div className="text-[11px] text-fg-subtle">
                    Best <span className="pos num">+{metrics.bestYear.return.toFixed(1)}%</span>{" "}
                    ({metrics.bestYear.year}) · Worst{" "}
                    <span className="neg num">{metrics.worstYear.return.toFixed(1)}%</span>{" "}
                    ({metrics.worstYear.year})
                  </div>
                )}
              </div>
              <YearlyReturnsBars years={metrics.yearlyReturns} />
            </div>
          )}

          {/* Rolling 1Y returns */}
          {metrics.rolling1y && (
            <div className="mt-6 rounded-xl border border-border bg-bg-soft/40 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="label">Rolling 1-year returns</div>
                <div className="text-[11px] text-fg-subtle">
                  {metrics.rolling1y.sampleCount.toLocaleString()} overlapping windows
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <RollingStat
                  label="Best"
                  value={`+${metrics.rolling1y.bestReturn.toFixed(2)}%`}
                  tone="pos"
                  icon={<ArrowUpRight className="h-3.5 w-3.5" />}
                />
                <RollingStat
                  label="Worst"
                  value={`${metrics.rolling1y.worstReturn.toFixed(2)}%`}
                  tone={metrics.rolling1y.worstReturn < 0 ? "neg" : "pos"}
                  icon={<ArrowDownRight className="h-3.5 w-3.5" />}
                />
                <RollingStat
                  label="Average"
                  value={`${metrics.rolling1y.averageReturn >= 0 ? "+" : ""}${metrics.rolling1y.averageReturn.toFixed(2)}%`}
                  tone={metrics.rolling1y.averageReturn >= 0 ? "pos" : "neg"}
                />
                <RollingStat
                  label="Median"
                  value={`${metrics.rolling1y.medianReturn >= 0 ? "+" : ""}${metrics.rolling1y.medianReturn.toFixed(2)}%`}
                  tone={metrics.rolling1y.medianReturn >= 0 ? "pos" : "neg"}
                />
              </div>
              <p className="mt-3 text-[11px] text-fg-subtle">
                What every 1-year holding period would've returned, summarised.
                Median &gt; 0 means a typical investor entering on a random day
                would've ended up positive a year later.
              </p>
            </div>
          )}

          {/* Max drawdown detail */}
          {metrics.maxDrawdown && (
            <div className="mt-6 rounded-xl border border-danger/30 bg-danger/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="label flex items-center gap-2">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Worst observed drawdown
                </div>
                <div className="num neg text-sm font-semibold">
                  −{metrics.maxDrawdown.percentDecline.toFixed(2)}%
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs md:grid-cols-3">
                <Detail
                  label="Peak"
                  value={`${formatCurrency(toNum(metrics.maxDrawdown.peakNav))} on ${formatDate(metrics.maxDrawdown.peakDate)}`}
                />
                <Detail
                  label="Trough"
                  value={`${formatCurrency(toNum(metrics.maxDrawdown.troughNav))} on ${formatDate(metrics.maxDrawdown.troughDate)}`}
                />
                <Detail
                  label="Recovery"
                  value={
                    metrics.maxDrawdown.recoveryDate
                      ? formatDate(metrics.maxDrawdown.recoveryDate)
                      : "still under peak"
                  }
                />
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Kpi({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: "pos" | "neg";
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-bg-soft/40 p-3">
      <div className="label flex items-center gap-1.5">
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "num mt-1 text-base font-semibold",
          tone === "pos" && "pos",
          tone === "neg" && "neg",
        )}
      >
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-[10px] text-fg-subtle">{hint}</div>
      )}
    </div>
  );
}

function RollingStat({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <div className="label flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "num mt-0.5 text-sm font-semibold",
          tone === "pos" && "pos",
          tone === "neg" && "neg",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-fg-muted">
        {label}
      </div>
      <div className="num text-fg">{value}</div>
    </div>
  );
}

function YearlyReturnsBars({ years }: { years: Array<{ year: number; return: number }> }) {
  const max = Math.max(...years.map((y) => Math.abs(y.return)), 1);
  return (
    <div className="flex items-end gap-2 overflow-x-auto pb-1">
      {years.map((y) => {
        const positive = y.return >= 0;
        const heightPct = (Math.abs(y.return) / max) * 100;
        return (
          <div
            key={y.year}
            className="flex min-w-[44px] flex-1 flex-col items-center gap-1"
            title={`${y.year}: ${y.return >= 0 ? "+" : ""}${y.return.toFixed(2)}%`}
          >
            <div className="flex h-24 w-full items-end justify-center">
              <div
                className={cn(
                  "w-full rounded-t",
                  positive ? "bg-success/70" : "bg-danger/70",
                )}
                style={{ height: `${Math.max(heightPct, 4)}%` }}
              />
            </div>
            <div
              className={cn(
                "num text-[10px] font-medium",
                positive ? "pos" : "neg",
              )}
            >
              {positive ? "+" : ""}
              {y.return.toFixed(0)}%
            </div>
            <div className="text-[10px] text-fg-subtle">{y.year}</div>
          </div>
        );
      })}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
