import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarClock,
  ChevronDown,
  CircleDot,
  Pause,
  Pencil,
  Play,
  Plus,
  Radio,
  Trash2,
} from "lucide-react";
import { useCancelSip, useSips, useUpdateSipStatus, type SipPlan } from "@/hooks/useSips";
import { SipForm } from "@/components/SipForm";
import { SipEditDialog } from "@/components/SipEditDialog";
import { SipProjectionChart } from "@/components/SipProjectionChart";
import { formatCountdown, useCountdown } from "@/components/Countdown";
import { useLivePrices } from "@/hooks/useLivePrices";
import { cn, formatCompact, formatCurrency, toNum } from "@/lib/utils";
import {
  annualContribution,
  sipFutureValue,
  sipInvested,
  type Frequency,
} from "@/lib/sip";

type StatusFilter = "all" | "active" | "paused" | "cancelled";

export function SipsPage() {
  const { data = [], isLoading } = useSips();
  const update = useUpdateSipStatus();
  const cancel = useCancelSip();
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingPlan, setEditingPlan] = useState<SipPlan | null>(null);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return data;
    return data.filter((p) => p.status === statusFilter);
  }, [data, statusFilter]);

  const totals = useMemo(() => {
    const active = data.filter((p) => p.status === "active");
    const monthlyInr = active.reduce(
      (s, p) => s + annualContribution(toNum(p.amount), p.frequency as Frequency) / 12,
      0,
    );
    return { activeCount: active.length, monthlyInr, totalCount: data.length };
  }, [data]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: data.length,
      active: 0,
      paused: 0,
      cancelled: 0,
    };
    for (const p of data) c[p.status]++;
    return c;
  }, [data]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-fg-muted">Systematic</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">SIPs</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Schedule recurring buys at the live market price.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4" /> New SIP
        </button>
      </header>

      <section className="grid grid-cols-3 gap-4">
        <Metric label="Active" value={totals.activeCount.toString()} tone="brand" />
        <Metric
          label="Monthly commitment"
          value={formatCurrency(totals.monthlyInr)}
          tone="success"
        />
        <Metric label="Total plans" value={totals.totalCount.toString()} />
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <div className="label">Your plans</div>
            <div className="text-xs text-fg-muted">
              {data.length} total · {totals.activeCount} running
            </div>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-bg-soft p-0.5">
            {(["all", "active", "paused", "cancelled"] as StatusFilter[]).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                  statusFilter === s
                    ? "rounded-md bg-white/10 text-fg"
                    : "text-fg-muted hover:text-fg",
                )}
              >
                {s}
                <span className="num rounded-full bg-white/5 px-1.5 text-[10px]">
                  {counts[s]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="py-10 text-center text-sm text-fg-muted">Loading…</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            onCreate={() => setShowForm(true)}
            filtered={statusFilter !== "all"}
          />
        ) : (
          <ul className="divide-y divide-border/40">
            {filtered.map((plan, i) => (
              <Row
                key={plan.id}
                plan={plan}
                index={i}
                expanded={expandedId === plan.id}
                onToggleExpand={() =>
                  setExpandedId(expandedId === plan.id ? null : plan.id)
                }
                onToggle={(status) => update.mutate({ id: plan.id, status })}
                onCancel={() => cancel.mutate(plan.id)}
                onEdit={() => setEditingPlan(plan)}
              />
            ))}
          </ul>
        )}
      </section>

      <SipForm open={showForm} onOpenChange={setShowForm} />
      <SipEditDialog
        open={!!editingPlan}
        onOpenChange={(v) => !v && setEditingPlan(null)}
        plan={editingPlan}
      />
    </div>
  );
}

function Row({
  plan,
  index,
  expanded,
  onToggleExpand,
  onToggle,
  onCancel,
  onEdit,
}: {
  plan: SipPlan;
  index: number;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggle: (status: "active" | "paused") => void;
  onCancel: () => void;
  onEdit: () => void;
}) {
  const { quotes } = useLivePrices();
  const isActive = plan.status === "active";
  const isCancelled = plan.status === "cancelled";
  const nextRun = useMemo(() => new Date(plan.nextRunAt), [plan.nextRunAt]);
  const msLeft = useCountdown(nextRun);
  const runningNow = isActive && msLeft <= 0;

  const amount = toNum(plan.amount);
  const livePrice = toNum(quotes[plan.ticker]?.price);
  const unitsPerRun = livePrice > 0 ? amount / livePrice : 0;

  return (
    <li>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: Math.min(index, 10) * 0.03 }}
        className="flex items-center justify-between gap-4 px-5 py-4"
      >
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex flex-1 items-center gap-4 text-left"
        >
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg text-sm font-semibold",
              plan.assetType === "mf"
                ? "bg-violet-500/15 text-violet-300"
                : "bg-cyan-500/15 text-cyan-300",
            )}
          >
            {plan.ticker.slice(0, 2)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium">{plan.ticker}</span>
              <span
                className={cn(
                  "chip text-[10px] capitalize",
                  isActive && "border-success/30 text-success",
                  plan.status === "paused" && "border-warn/30 text-warn",
                  isCancelled && "border-border text-fg-muted",
                )}
              >
                <CircleDot className="h-2.5 w-2.5" />
                {plan.status}
              </span>
            </div>
            <div className="num text-xs text-fg-muted">
              {formatCurrency(amount)} · {plan.frequency}
              {livePrice > 0 && (
                <>
                  {" · "}
                  <span className="text-fg-subtle">≈</span>{" "}
                  <span className="text-fg">{unitsPerRun.toFixed(4)}</span>{" "}
                  units
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isActive && (
              <span
                className={cn(
                  "chip num",
                  runningNow
                    ? "border-success/40 text-success"
                    : "border-border text-fg-muted",
                )}
              >
                {runningNow ? <Radio className="h-3 w-3 animate-pulse" /> : <CalendarClock className="h-3 w-3" />}
                {formatCountdown(Math.max(msLeft, 0))}
              </span>
            )}
            <ChevronDown
              className={cn(
                "h-4 w-4 text-fg-muted transition-transform",
                expanded && "rotate-180",
              )}
            />
          </div>
        </button>
        <div className="flex items-center gap-1 border-l border-border/60 pl-3">
          {!isCancelled && (
            <>
              <button
                type="button"
                onClick={onEdit}
                className="rounded-md p-2 text-fg-muted hover:bg-white/5 hover:text-fg"
                aria-label="Edit plan"
                title="Edit"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onToggle(isActive ? "paused" : "active")}
                className="btn-ghost h-8 px-2 text-xs"
                aria-label={isActive ? "Pause" : "Resume"}
              >
                {isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {isActive ? "Pause" : "Resume"}
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md p-2 text-fg-muted hover:bg-white/5 hover:text-danger"
                aria-label="Cancel plan"
                title="Cancel"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </motion.div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="expand"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden border-t border-border/60 bg-bg-soft/30"
          >
            <ExpandedDetail plan={plan} />
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function ExpandedDetail({ plan }: { plan: SipPlan }) {
  const amount = toNum(plan.amount);
  const freq = plan.frequency as Frequency;
  const [rate, setRate] = useState(12);
  const annual = annualContribution(amount, freq);

  const fiveYearValue = sipFutureValue(amount, freq, 5, rate / 100);
  const tenYearValue = sipFutureValue(amount, freq, 10, rate / 100);
  const fifteenYearValue = sipFutureValue(amount, freq, 15, rate / 100);
  const tenYearInvested = sipInvested(amount, freq, 10);

  return (
    <div className="grid grid-cols-1 gap-4 px-5 py-4 md:grid-cols-[auto_1fr]">
      <div className="space-y-3 md:w-52">
        <Stat label="Per year" value={formatCurrency(annual)} />
        <Stat label="At 5 years" value={formatCompact(fiveYearValue)} />
        <Stat label="At 10 years" value={formatCompact(tenYearValue)} tone="brand" />
        <Stat label="At 15 years" value={formatCompact(fifteenYearValue)} />
        <Stat
          label="10y gain"
          value={formatCompact(tenYearValue - tenYearInvested)}
          tone={tenYearValue - tenYearInvested >= 0 ? "pos" : "neg"}
        />
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="label">Projected growth</span>
          <label className="flex items-center gap-2 text-[11px] text-fg-muted">
            return
            <input
              type="range"
              min={4}
              max={20}
              step={0.5}
              value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
              className="accent-brand"
            />
            <span className="num text-brand">{rate}%</span>
          </label>
        </div>
        <SipProjectionChart
          amount={amount}
          frequency={freq}
          annualRate={rate / 100}
          maxYears={15}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg" | "brand";
}) {
  return (
    <div>
      <div className="label">{label}</div>
      <div
        className={cn(
          "num mt-0.5 text-sm font-medium",
          tone === "pos" && "pos",
          tone === "neg" && "neg",
          tone === "brand" && "text-brand",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "brand" | "success";
}) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div
        className={cn(
          "num mt-2 text-2xl font-semibold",
          tone === "brand" && "text-brand",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function EmptyState({
  onCreate,
  filtered,
}: {
  onCreate: () => void;
  filtered: boolean;
}) {
  return (
    <div className="px-6 py-14 text-center">
      <CalendarClock className="mx-auto h-10 w-10 text-fg-subtle" />
      <p className="mt-4 text-sm text-fg-muted">
        {filtered
          ? "No plans in this state."
          : "No SIPs yet. A disciplined SIP beats timing the market — start one."}
      </p>
      {!filtered && (
        <button className="btn-primary mt-5 text-xs" onClick={onCreate}>
          <Plus className="h-3.5 w-3.5" /> Create your first SIP
        </button>
      )}
    </div>
  );
}
