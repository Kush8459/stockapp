import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Banknote,
  LineChart as LineChartIcon,
  PiggyBank,
  Receipt,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  useFundamentals,
  type BalanceSheetPeriod,
  type CashFlowPeriod,
  type Fundamentals,
  type YearlyFinancials,
} from "@/hooks/useFundamentals";
import { useChartTheme } from "@/hooks/useChartTheme";
import { cn, formatCompact } from "@/lib/utils";

interface Props {
  ticker: string;
}

type Tab = "income" | "balance" | "cashflow";
type Period = "yearly" | "quarterly";

interface Metric {
  key: string;
  label: string;
  color: string;
}

const incomeMetrics: Metric[] = [
  { key: "totalRevenue", label: "Revenue", color: "#06b6d4" },
  { key: "grossProfit", label: "Gross Profit", color: "#a855f7" },
  { key: "operatingIncome", label: "Operating Income", color: "#f59e0b" },
  { key: "netIncome", label: "Net Profit", color: "#10b981" },
  { key: "ebitda", label: "EBITDA", color: "#3b82f6" },
];
const balanceMetrics: Metric[] = [
  { key: "totalAssets", label: "Total Assets", color: "#06b6d4" },
  { key: "totalLiabilities", label: "Total Liabilities", color: "#ef4444" },
  { key: "stockholderEquity", label: "Equity", color: "#10b981" },
  { key: "longTermDebt", label: "Long-term Debt", color: "#f59e0b" },
  { key: "cash", label: "Cash", color: "#a855f7" },
];
const cashflowMetrics: Metric[] = [
  { key: "operatingCashFlow", label: "Operating CF", color: "#06b6d4" },
  { key: "investingCashFlow", label: "Investing CF", color: "#a855f7" },
  { key: "financingCashFlow", label: "Financing CF", color: "#f59e0b" },
  { key: "freeCashFlow", label: "Free CF", color: "#10b981" },
  { key: "capEx", label: "CapEx", color: "#ef4444" },
];

const tabMeta: Record<
  Tab,
  { label: string; icon: React.ReactNode; metrics: Metric[]; defaults: string[] }
> = {
  income: {
    label: "Income",
    icon: <Receipt className="h-3.5 w-3.5" />,
    metrics: incomeMetrics,
    defaults: ["totalRevenue", "netIncome"],
  },
  balance: {
    label: "Balance Sheet",
    icon: <Banknote className="h-3.5 w-3.5" />,
    metrics: balanceMetrics,
    defaults: ["totalAssets", "totalLiabilities"],
  },
  cashflow: {
    label: "Cash Flow",
    icon: <PiggyBank className="h-3.5 w-3.5" />,
    metrics: cashflowMetrics,
    defaults: ["operatingCashFlow", "freeCashFlow"],
  },
};

export function FinancialsCard({ ticker }: Props) {
  const { data, isLoading } = useFundamentals(ticker);
  const chartTheme = useChartTheme();
  const [tab, setTab] = useState<Tab>("income");
  const [period, setPeriod] = useState<Period>("yearly");
  const [selected, setSelected] = useState<Record<Tab, string[]>>({
    income: tabMeta.income.defaults,
    balance: tabMeta.balance.defaults,
    cashflow: tabMeta.cashflow.defaults,
  });

  const rows = useMemo(
    () => pickRows(data, tab, period),
    [data, tab, period],
  );
  const altRows = useMemo(
    () => pickRows(data, tab, period === "yearly" ? "quarterly" : "yearly"),
    [data, tab, period],
  );

  const metricsForTab = tabMeta[tab].metrics;

  // A metric is "available" if at least one row has a non-zero value for
  // it. Yahoo sometimes returns 0 for fields it doesn't track (e.g.
  // grossProfit for Indian stocks that don't break out cost of revenue).
  // Treating those as missing prevents chips that produce empty bars.
  const availableMetrics = useMemo(() => {
    const set = new Set<string>();
    for (const m of metricsForTab) {
      for (const r of rows) {
        const v = (r as unknown as Record<string, unknown>)[m.key];
        if (typeof v === "number" && v !== 0) {
          set.add(m.key);
          break;
        }
      }
    }
    return set;
  }, [metricsForTab, rows]);

  // Same check for the alternate period — used to suggest "Try Yearly /
  // Try Quarterly" when the active period has nothing.
  const altHasAny = useMemo(() => {
    for (const m of metricsForTab) {
      for (const r of altRows) {
        const v = (r as unknown as Record<string, unknown>)[m.key];
        if (typeof v === "number" && v !== 0) return true;
      }
    }
    return false;
  }, [metricsForTab, altRows]);

  const sel = selected[tab];
  const visibleSel = sel.filter((k) => availableMetrics.has(k));

  // Auto-fall-back: when the user lands on a tab/period combination where
  // none of their currently-selected metrics have data, swap them out for
  // the first metric that DOES — so the chart is never blank when there's
  // something to show.
  useEffect(() => {
    if (rows.length === 0) return;
    if (availableMetrics.size === 0) return;
    if (sel.some((k) => availableMetrics.has(k))) return;
    const firstAvailable = metricsForTab.find((m) => availableMetrics.has(m.key));
    if (!firstAvailable) return;
    setSelected((s) => ({ ...s, [tab]: [firstAvailable.key] }));
    // We deliberately depend on tab+period via rows/availableMetrics; sel
    // changes shouldn't retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, period, rows.length, availableMetrics]);

  function toggle(key: string) {
    if (!availableMetrics.has(key)) return;
    setSelected((s) => {
      const cur = s[tab];
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      return { ...s, [tab]: next };
    });
  }

  if (isLoading) {
    return (
      <section className="card p-5">
        <div className="label">Financials</div>
        <div className="mt-3 text-sm text-fg-muted">Loading…</div>
      </section>
    );
  }

  const noData =
    !data ||
    ((data.financials?.length ?? 0) === 0 &&
      (data.balanceSheets?.length ?? 0) === 0 &&
      (data.cashFlows?.length ?? 0) === 0 &&
      (data.quarterlyFinancials?.length ?? 0) === 0 &&
      (data.quarterlyBalanceSheets?.length ?? 0) === 0 &&
      (data.quarterlyCashFlows?.length ?? 0) === 0);
  if (noData) {
    // Show a visible placeholder rather than hiding silently — easier to
    // debug if Yahoo isn't returning data for the ticker.
    return (
      <section className="card p-5">
        <div className="label inline-flex items-center gap-1.5">
          <LineChartIcon className="h-3 w-3" /> Financials
        </div>
        <div className="mt-3 text-sm text-fg-muted">
          Yahoo doesn't have financial-statement data for {ticker} yet.
          Common for indices, ETFs, mutual funds and recently-listed stocks.
        </div>
      </section>
    );
  }

  // Order chronologically (oldest → newest) for the chart.
  const sortedRows = [...rows].sort(
    (a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime(),
  );
  const chartData = sortedRows.map((r) => {
    const obj: Record<string, string | number> = {
      label: period === "yearly" ? `FY${r.year}` : quarterLabel(r.endDate),
    };
    for (const m of metricsForTab) {
      obj[m.key] = (r as any)[m.key] ?? 0;
    }
    return obj;
  });

  const yearlyAvail = (data.financials?.length ?? 0) > 0 || (data.balanceSheets?.length ?? 0) > 0 || (data.cashFlows?.length ?? 0) > 0;
  const quarterlyAvail = (data.quarterlyFinancials?.length ?? 0) > 0 || (data.quarterlyBalanceSheets?.length ?? 0) > 0 || (data.quarterlyCashFlows?.length ?? 0) > 0;

  const latest = rows[0];
  const prior = rows[1];

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="card p-5"
    >
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label inline-flex items-center gap-1.5">
            <LineChartIcon className="h-3 w-3" /> Financials
          </div>
          <p className="mt-1 text-xs text-fg-muted">
            Tap any metric to add or remove it from the chart. Source: Yahoo Finance.
          </p>
        </div>
        <PeriodToggle
          value={period}
          onChange={setPeriod}
          yearlyAvail={yearlyAvail}
          quarterlyAvail={quarterlyAvail}
        />
      </header>

      {/* Tabs */}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-border/40">
        {(Object.keys(tabMeta) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors",
              tab === t
                ? "border-brand text-fg"
                : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {tabMeta[t].icon}
            {tabMeta[t].label}
          </button>
        ))}
      </div>

      {rows.length === 0 || availableMetrics.size === 0 ? (
        <EmptySlice
          tab={tab}
          period={period}
          altHasAny={altHasAny}
          onSwitchPeriod={() => setPeriod(period === "yearly" ? "quarterly" : "yearly")}
        />
      ) : (
        <>
          {/* Metric chips. We hide unavailable ones entirely — no point
              tempting the user to tap something that has no data. */}
          <div className="mb-4 flex flex-wrap gap-1.5">
            {metricsForTab
              .filter((m) => availableMetrics.has(m.key))
              .map((m) => {
                const active = sel.includes(m.key);
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => toggle(m.key)}
                    title={m.label}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                      active
                        ? "text-fg"
                        : "bg-bg-soft/60 text-fg-muted hover:bg-bg-soft hover:text-fg",
                    )}
                    style={
                      active
                        ? { background: m.color + "26", color: m.color }
                        : undefined
                    }
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: m.color }}
                    />
                    {m.label}
                  </button>
                );
              })}
          </div>

          {/* Chart + stats */}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-[1.4fr_1fr]">
            <div className="h-56">
              {sel.length === 0 ? (
                <div className="flex h-full items-center justify-center rounded-lg border border-border/40 bg-bg-soft/30 text-xs text-fg-muted">
                  Select at least one metric.
                </div>
              ) : visibleSel.length === 0 ? (
                <NoDataForSelected
                  altHasAny={altHasAny}
                  period={period}
                  onSwitchPeriod={() => setPeriod(period === "yearly" ? "quarterly" : "yearly")}
                />
              ) : (
                <ResponsiveContainer>
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.border} vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: chartTheme.fgMuted, fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: chartTheme.fgMuted, fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => formatCompact(v)}
                      width={78}
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
                      formatter={(value: number, name: string) => [
                        formatCompact(value),
                        labelFor(metricsForTab, name),
                      ]}
                      cursor={{ fill: `${chartTheme.fg}0a` }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 11 }}
                      formatter={(value) => (
                        <span className="text-fg-muted">
                          {labelFor(metricsForTab, value)}
                        </span>
                      )}
                    />
                    {metricsForTab
                      .filter((m) => sel.includes(m.key) && availableMetrics.has(m.key))
                      .map((m) => (
                        <Bar
                          key={m.key}
                          dataKey={m.key}
                          name={m.key}
                          fill={m.color}
                          radius={[3, 3, 0, 0]}
                        />
                      ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="space-y-2">
              {latest && visibleSel.length > 0 ? (
                <>
                  <div className="label mb-1">
                    {period === "yearly"
                      ? `FY${latest.year}`
                      : quarterLabel(latest.endDate)}
                  </div>
                  {metricsForTab
                    .filter((m) => sel.includes(m.key) && availableMetrics.has(m.key))
                    .map((m) => (
                      <Row
                        key={m.key}
                        label={m.label}
                        color={m.color}
                        value={(latest as unknown as Record<string, number | undefined>)[m.key]}
                        priorValue={prior ? (prior as unknown as Record<string, number | undefined>)[m.key] : undefined}
                      />
                    ))}
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-border/50 px-3 py-4 text-[11px] text-fg-subtle">
                  {sel.length === 0
                    ? "Pick a metric to see its latest value here."
                    : "Selected metrics have no data for this period."}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </motion.section>
  );
}

function EmptySlice({
  tab,
  period,
  altHasAny,
  onSwitchPeriod,
}: {
  tab: Tab;
  period: Period;
  altHasAny: boolean;
  onSwitchPeriod: () => void;
}) {
  const altLabel = period === "yearly" ? "Quarterly" : "Yearly";
  return (
    <div className="rounded-lg border border-border/40 bg-bg-soft/30 px-3 py-6 text-center">
      <p className="text-sm text-fg-muted">
        Yahoo doesn't have {period} {tabMeta[tab].label.toLowerCase()} data for this ticker.
      </p>
      {altHasAny && (
        <button
          type="button"
          onClick={onSwitchPeriod}
          className="btn-outline mt-3 h-7 px-3 text-xs"
        >
          Switch to {altLabel}
        </button>
      )}
    </div>
  );
}

function NoDataForSelected({
  altHasAny,
  period,
  onSwitchPeriod,
}: {
  altHasAny: boolean;
  period: Period;
  onSwitchPeriod: () => void;
}) {
  const altLabel = period === "yearly" ? "Quarterly" : "Yearly";
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-border/40 bg-bg-soft/30 px-3 text-xs text-fg-muted">
      <p>The metrics you picked have no {period} data here.</p>
      {altHasAny && (
        <button
          type="button"
          onClick={onSwitchPeriod}
          className="btn-outline h-7 px-3 text-[11px]"
        >
          Try {altLabel}
        </button>
      )}
    </div>
  );
}

function pickRows(
  data: Fundamentals | undefined,
  tab: Tab,
  period: Period,
): Array<YearlyFinancials | BalanceSheetPeriod | CashFlowPeriod> {
  if (!data) return [];
  if (tab === "income") {
    return (period === "yearly" ? data.financials : data.quarterlyFinancials) ?? [];
  }
  if (tab === "balance") {
    return (period === "yearly" ? data.balanceSheets : data.quarterlyBalanceSheets) ?? [];
  }
  return (period === "yearly" ? data.cashFlows : data.quarterlyCashFlows) ?? [];
}

function PeriodToggle({
  value,
  onChange,
  yearlyAvail,
  quarterlyAvail,
}: {
  value: Period;
  onChange: (p: Period) => void;
  yearlyAvail: boolean;
  quarterlyAvail: boolean;
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-bg-soft p-0.5 text-xs">
      <button
        type="button"
        onClick={() => onChange("yearly")}
        disabled={!yearlyAvail}
        className={cn(
          "rounded px-2.5 py-1 font-medium transition-colors disabled:opacity-40",
          value === "yearly" ? "bg-overlay/10 text-fg" : "text-fg-muted hover:text-fg",
        )}
      >
        Yearly
      </button>
      <button
        type="button"
        onClick={() => onChange("quarterly")}
        disabled={!quarterlyAvail}
        className={cn(
          "rounded px-2.5 py-1 font-medium transition-colors disabled:opacity-40",
          value === "quarterly" ? "bg-overlay/10 text-fg" : "text-fg-muted hover:text-fg",
        )}
      >
        Quarterly
      </button>
    </div>
  );
}

function Row({
  label,
  color,
  value,
  priorValue,
}: {
  label: string;
  color: string;
  value?: number;
  priorValue?: number;
}) {
  if (value == null) return null;
  let delta: { pct: number; tone: "pos" | "neg" } | null = null;
  if (priorValue != null && priorValue !== 0) {
    const pct = ((value - priorValue) / Math.abs(priorValue)) * 100;
    delta = { pct, tone: pct >= 0 ? "pos" : "neg" };
  }
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="inline-flex items-center gap-1.5 text-fg-muted">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        {label}
      </span>
      <span className="num text-right font-medium">
        {formatCompact(value)}
        {delta && (
          <span
            className={cn(
              "ml-2 num text-[11px] font-medium",
              delta.tone === "pos" ? "pos" : "neg",
            )}
          >
            {delta.pct >= 0 ? "+" : ""}
            {delta.pct.toFixed(1)}%
          </span>
        )}
      </span>
    </div>
  );
}

function quarterLabel(iso: string): string {
  const d = new Date(iso);
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${String(d.getFullYear()).slice(2)}`;
}

function labelFor(metrics: Metric[], key: string): string {
  return metrics.find((m) => m.key === key)?.label ?? key;
}
