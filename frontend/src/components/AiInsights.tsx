import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Compass,
  Info,
  Lightbulb,
  Loader2,
  PieChart,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  useInsights,
  useRefreshInsights,
  type Category,
  type HealthLabel,
  type Highlight,
  type Insight,
  type InsightError,
  type Priority,
  type Severity,
} from "@/hooks/useInsights";
import { cn } from "@/lib/utils";

/** Professional, data-grounded AI portfolio review. */
export function AiInsights() {
  const { data, isLoading, error } = useInsights();
  const refresh = useRefreshInsights();
  const loading = isLoading || refresh.isPending;

  // Always force a fresh network call on click — using the POST /refresh
  // mutation ensures we bypass any cached error state and always hit the
  // server, so the backend logs can show us what's happening.
  const onRefresh = () => {
    // eslint-disable-next-line no-console
    console.debug("[insights] refresh button → POST /insights/refresh");
    refresh.mutate();
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="card overflow-hidden"
    >
      <Header data={data} loading={loading} onRefresh={onRefresh} />

      <div className="p-5">
        {loading && !data ? (
          <Skeleton />
        ) : error ? (
          <ErrorState err={error as unknown as InsightError} />
        ) : data ? (
          <Body data={data} />
        ) : null}
      </div>

      {data && <Footer data={data} />}
    </motion.section>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header({
  data,
  loading,
  onRefresh,
}: {
  data?: Insight;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="relative flex items-start justify-between gap-3 overflow-hidden border-b border-border px-5 py-4">
      {/* Subtle gradient sheen to make the section feel premium. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-cyan-500/[0.04] via-transparent to-violet-500/[0.04]"
      />
      <div className="relative flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/20 to-violet-500/20 text-brand shadow-glow">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="leading-tight">
          <div className="flex items-center gap-2">
            <span className="font-semibold">Portfolio review</span>
            <span className="chip text-[10px]">AI</span>
          </div>
          <div className="mt-0.5 text-[11px] text-fg-muted">
            {data
              ? `${data.cached ? "Cached" : "Fresh"} · ${timeAgo(data.generatedAt)} · ${data.model} · analyzed ${data.input.holdings} holdings · ${data.input.transactions} recent txns · ${data.input.sips} SIPs`
              : "AI-generated assessment of your portfolio"}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={loading}
        className="btn-ghost relative h-8 px-2 text-xs"
        aria-label="Regenerate"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        {loading ? "Regenerating…" : "Refresh"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Body — the content
// ---------------------------------------------------------------------------

function Body({ data }: { data: Insight }) {
  return (
    <div className="space-y-6">
      <Hero data={data} />
      <SubScores scores={data.healthScore} />
      <Highlights h={data.keyHighlights} />
      <AnalysisGrid a={data.analysis} />
      <Buckets data={data} />
      <NextSteps items={data.nextSteps} />
    </div>
  );
}

// --- Hero: big summary + overall dial --------------------------------------

function Hero({ data }: { data: Insight }) {
  return (
    <div className="grid grid-cols-1 items-center gap-5 md:grid-cols-[auto_1fr]">
      <BigDial score={data.healthScore.overall} label={data.healthScore.label} />
      <div>
        <div className="label mb-2 flex items-center gap-1.5">
          <Activity className="h-3 w-3" /> Executive summary
        </div>
        <p className="text-sm leading-relaxed text-fg md:text-base">
          {data.executiveSummary}
        </p>
      </div>
    </div>
  );
}

function BigDial({ score, label }: { score: number; label: HealthLabel }) {
  const tone = toneForLabel(label);
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(score, 100)) / 100);

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-28 w-28">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="7" className="stroke-white/5" />
          <motion.circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            strokeWidth="7"
            strokeLinecap="round"
            className={tone.stroke}
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }}
          />
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center leading-tight">
          <div className={cn("num text-3xl font-semibold", tone.text)}>{score}</div>
          <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
            health
          </div>
        </div>
      </div>
      <div className="leading-tight">
        <div className="label">Overall</div>
        <div className={cn("mt-1 text-lg font-semibold", tone.text)}>{label}</div>
        <div className="num mt-0.5 text-[11px] text-fg-muted">
          out of 100
        </div>
      </div>
    </div>
  );
}

// --- Sub-scores: 4 small radial gauges -------------------------------------

function SubScores({ scores }: { scores: Insight["healthScore"] }) {
  const items: Array<{
    key: string;
    label: string;
    value: number;
    icon: ReactNode;
  }> = [
    {
      key: "diversification",
      label: "Diversification",
      value: scores.diversification,
      icon: <PieChart className="h-3 w-3" />,
    },
    {
      key: "riskManagement",
      label: "Risk mgmt",
      value: scores.riskManagement,
      icon: <ShieldCheck className="h-3 w-3" />,
    },
    {
      key: "performance",
      label: "Performance",
      value: scores.performance,
      icon: <TrendingUp className="h-3 w-3" />,
    },
    {
      key: "discipline",
      label: "Discipline",
      value: scores.discipline,
      icon: <Compass className="h-3 w-3" />,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 rounded-xl border border-border/60 bg-bg-soft/40 p-3 md:grid-cols-4">
      {items.map((it, i) => (
        <MiniGauge
          key={it.key}
          value={it.value}
          label={it.label}
          icon={it.icon}
          index={i}
        />
      ))}
    </div>
  );
}

function MiniGauge({
  value,
  label,
  icon,
  index,
}: {
  value: number;
  label: string;
  icon: ReactNode;
  index: number;
}) {
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(value, 100)) / 100);
  const tone =
    value >= 80
      ? "stroke-success text-success"
      : value >= 60
        ? "stroke-brand text-brand"
        : value >= 40
          ? "stroke-warn text-warn"
          : "stroke-danger text-danger";
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 * index }}
      className="flex items-center gap-3"
    >
      <div className="relative h-14 w-14 shrink-0">
        <svg viewBox="0 0 60 60" className="h-full w-full -rotate-90">
          <circle cx="30" cy="30" r={radius} fill="none" strokeWidth="4" className="stroke-white/5" />
          <motion.circle
            cx="30"
            cy="30"
            r={radius}
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            className={tone.split(" ")[0]}
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
          />
        </svg>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className={cn("num text-xs font-semibold", tone.split(" ")[1])}>
            {value}
          </span>
        </div>
      </div>
      <div className="min-w-0 leading-tight">
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-fg-muted">
          {icon}
          {label}
        </div>
        <div className={cn("num mt-0.5 text-sm font-medium", tone.split(" ")[1])}>
          {value} <span className="text-fg-subtle">/ 100</span>
        </div>
      </div>
    </motion.div>
  );
}

// --- Key highlight cards ---------------------------------------------------

function Highlights({ h }: { h: Insight["keyHighlights"] }) {
  const cards: Array<{
    key: string;
    label: string;
    icon: ReactNode;
    tone: string;
    data?: Highlight;
  }> = [
    {
      key: "topPerformer",
      label: "Top performer",
      icon: <TrendingUp className="h-3.5 w-3.5" />,
      tone: "border-success/30 text-success bg-success/5",
      data: h.topPerformer,
    },
    {
      key: "topLaggard",
      label: "Top laggard",
      icon: <TrendingDown className="h-3.5 w-3.5" />,
      tone: "border-danger/30 text-danger bg-danger/5",
      data: h.topLaggard,
    },
    {
      key: "biggestPosition",
      label: "Biggest position",
      icon: <PieChart className="h-3.5 w-3.5" />,
      tone: "border-violet-500/30 text-violet-300 bg-violet-500/5",
      data: h.biggestPosition,
    },
    {
      key: "fastestMover",
      label: "Fastest mover",
      icon: <Zap className="h-3.5 w-3.5" />,
      tone: "border-amber-500/30 text-amber-300 bg-amber-500/5",
      data: h.fastestMover,
    },
  ];

  const available = cards.filter((c) => !!c.data);
  if (available.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {available.map((c, i) => (
        <motion.div
          key={c.key}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.04 * i }}
          className={cn(
            "rounded-xl border p-3.5",
            c.tone,
          )}
        >
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider">
            {c.icon}
            {c.label}
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-semibold text-fg">{c.data!.ticker}</span>
            <span className="num text-xs">{c.data!.value}</span>
          </div>
          <div className="mt-1 text-[11px] leading-snug text-fg-muted">
            {c.data!.note}
          </div>
        </motion.div>
      ))}
    </div>
  );
}

// --- Analysis grid ---------------------------------------------------------

function AnalysisGrid({ a }: { a: Insight["analysis"] }) {
  const items: Array<{ label: string; icon: ReactNode; body: string }> = [
    { label: "Allocation", icon: <PieChart className="h-3.5 w-3.5" />, body: a.allocation },
    { label: "Concentration", icon: <AlertTriangle className="h-3.5 w-3.5" />, body: a.concentration },
    { label: "Performance", icon: <TrendingUp className="h-3.5 w-3.5" />, body: a.performance },
    { label: "Discipline", icon: <Compass className="h-3.5 w-3.5" />, body: a.discipline },
  ];
  return (
    <div>
      <div className="label mb-2 flex items-center gap-1.5">
        <Info className="h-3 w-3" /> Analysis
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {items.map((it, i) => (
          <motion.div
            key={it.label}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.03 * i }}
            className="rounded-lg border border-border/60 bg-bg-soft/40 p-3.5"
          >
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-fg-muted">
              {it.icon}
              {it.label}
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-fg">{it.body}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// --- Strengths / Risks / Suggestions ---------------------------------------

function Buckets({ data }: { data: Insight }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <BucketCard
        title="Strengths"
        tone="success"
        icon={<CheckCircle2 className="h-3.5 w-3.5" />}
      >
        {data.strengths.map((s, i) => (
          <StrengthItem key={i} title={s.title} detail={s.detail} />
        ))}
      </BucketCard>

      <BucketCard
        title="Risks"
        tone="danger"
        icon={<AlertTriangle className="h-3.5 w-3.5" />}
      >
        {[...data.risks]
          .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
          .map((r, i) => (
            <RiskItem key={i} {...r} />
          ))}
      </BucketCard>

      <BucketCard
        title="Suggestions"
        tone="brand"
        icon={<Lightbulb className="h-3.5 w-3.5" />}
      >
        {[...data.suggestions]
          .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority))
          .map((s, i) => (
            <SuggestionItem key={i} {...s} />
          ))}
      </BucketCard>
    </div>
  );
}

function BucketCard({
  title,
  tone,
  icon,
  children,
}: {
  title: string;
  tone: "success" | "danger" | "brand";
  icon: ReactNode;
  children: ReactNode;
}) {
  const toneCls = {
    success: "border-success/30 text-success bg-success/5",
    danger: "border-danger/30 text-danger bg-danger/5",
    brand: "border-brand/30 text-brand bg-brand/5",
  }[tone];
  return (
    <div className="flex flex-col rounded-xl border border-border/60 bg-bg-soft/40">
      <div
        className={cn(
          "flex items-center gap-1.5 border-b border-border/60 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider",
          toneCls,
        )}
      >
        {icon}
        {title}
      </div>
      <ul className="flex-1 space-y-2 p-3">{children}</ul>
    </div>
  );
}

function StrengthItem({ title, detail }: { title: string; detail: string }) {
  return (
    <li className="rounded-md px-1 py-1.5">
      <div className="text-[13px] font-medium">{title}</div>
      <div className="mt-0.5 text-[12px] leading-snug text-fg-muted">{detail}</div>
    </li>
  );
}

function RiskItem({
  title,
  detail,
  severity,
}: {
  title: string;
  detail: string;
  severity: Severity;
}) {
  const [open, setOpen] = useState(false);
  const tone = severityTone(severity);
  return (
    <li className="rounded-md">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-2 px-1 py-1.5 text-left"
      >
        <span className={cn("mt-[5px] h-2 w-2 shrink-0 rounded-full", tone.dot)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <span>{title}</span>
            <span className={cn("rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider", tone.chip)}>
              {severity}
            </span>
          </div>
          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden text-[12px] leading-snug text-fg-muted"
              >
                <div className="pt-1">{detail}</div>
              </motion.div>
            )}
          </AnimatePresence>
          {!open && (
            <div className="mt-0.5 truncate text-[12px] text-fg-muted">
              {detail}
            </div>
          )}
        </div>
        <ChevronDown
          className={cn("mt-1 h-3.5 w-3.5 shrink-0 text-fg-subtle transition-transform", open && "rotate-180")}
        />
      </button>
    </li>
  );
}

function SuggestionItem({
  title,
  detail,
  priority,
  category,
}: {
  title: string;
  detail: string;
  priority: Priority;
  category: Category;
}) {
  const pt = priorityTone(priority);
  return (
    <li className="rounded-md px-1 py-1.5">
      <div className="flex items-start gap-2">
        <ArrowRight className="mt-[3px] h-3 w-3 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
            <span>{title}</span>
            <span className={cn("rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider", pt.chip)}>
              {priority}
            </span>
            <span className="rounded-full border border-border bg-bg-soft px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-fg-muted">
              {category}
            </span>
          </div>
          <div className="mt-0.5 text-[12px] leading-snug text-fg-muted">
            {detail}
          </div>
        </div>
      </div>
    </li>
  );
}

// --- Next steps -----------------------------------------------------------

function NextSteps({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-brand/30 bg-gradient-to-br from-brand/[0.08] to-violet-500/[0.05] p-4">
      <div className="label mb-2 flex items-center gap-1.5 text-brand">
        <CircleDot className="h-3 w-3" /> Do this week
      </div>
      <ol className="space-y-1.5 text-sm">
        {items.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className="num w-4 shrink-0 text-fg-subtle">{i + 1}.</span>
            <span className="text-fg">{s}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// --- Footer ---------------------------------------------------------------

function Footer({ data }: { data: Insight }) {
  return (
    <div className="border-t border-border/60 bg-bg-soft/40 px-5 py-2.5 text-[10px] text-fg-subtle">
      AI-generated on {new Date(data.generatedAt).toLocaleString()} · This is
      an analysis of your portfolio shape, not financial advice. Do your own
      research before acting.
    </div>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function Skeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-[auto_1fr]">
        <div className="h-28 w-28 animate-pulse rounded-full bg-white/5" />
        <div className="space-y-2">
          <div className="h-3 w-1/3 animate-pulse rounded bg-white/5" />
          <div className="h-3 w-11/12 animate-pulse rounded bg-white/5" />
          <div className="h-3 w-10/12 animate-pulse rounded bg-white/5" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-white/5" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-white/5" />
        ))}
      </div>
    </div>
  );
}

function ErrorState({ err }: { err: InsightError }) {
  if (err.kind === "disabled") {
    return (
      <div className="px-2 py-6 text-center text-sm text-fg-muted">
        AI review is off. Set <code className="kbd">GEMINI_API_KEY</code> in{" "}
        <code className="kbd">.env</code> and restart the API to enable it.
      </div>
    );
  }
  if (err.kind === "upstream") {
    return (
      <div className="px-2 py-6 text-center text-sm text-fg-muted">
        AI provider is temporarily unavailable. Click Refresh to try again.
      </div>
    );
  }
  return (
    <div className="px-2 py-6 text-center text-sm text-fg-muted">
      Couldn&apos;t load insights: {err.message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toneForLabel(label: HealthLabel) {
  switch (label) {
    case "Excellent":
      return { text: "text-success", stroke: "stroke-success" };
    case "Good":
      return { text: "text-brand", stroke: "stroke-brand" };
    case "Fair":
      return { text: "text-warn", stroke: "stroke-warn" };
    case "Needs attention":
    default:
      return { text: "text-danger", stroke: "stroke-danger" };
  }
}

function severityRank(s: Severity): number {
  return { high: 3, medium: 2, low: 1 }[s];
}

function severityTone(s: Severity) {
  switch (s) {
    case "high":
      return { dot: "bg-danger", chip: "border-danger/40 text-danger bg-danger/10" };
    case "medium":
      return { dot: "bg-warn", chip: "border-warn/40 text-warn bg-warn/10" };
    case "low":
    default:
      return { dot: "bg-fg-subtle", chip: "border-border text-fg-muted bg-bg-soft" };
  }
}

function priorityRank(p: Priority): number {
  return { high: 3, medium: 2, low: 1 }[p];
}

function priorityTone(p: Priority) {
  switch (p) {
    case "high":
      return { chip: "border-brand/40 text-brand bg-brand/10" };
    case "medium":
      return { chip: "border-violet-500/40 text-violet-300 bg-violet-500/10" };
    case "low":
    default:
      return { chip: "border-border text-fg-muted bg-bg-soft" };
  }
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}
