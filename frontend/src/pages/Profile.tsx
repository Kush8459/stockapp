import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Briefcase,
  CalendarClock,
  Coins,
  Download,
  ExternalLink,
  FileText,
  Info,
  KeyRound,
  Landmark,
  ListOrdered,
  LogOut,
  Mail,
  PieChart,
  Plus,
  Pencil,
  Settings,
  Shield,
  ShieldCheck,
  Target,
  Trash2,
  User,
  Wallet2,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/store/auth";
import {
  useHoldings,
  usePortfolios,
  useSummary,
  useTransactions,
} from "@/hooks/usePortfolio";
import { useSips } from "@/hooks/useSips";
import { useAlerts } from "@/hooks/useAlerts";
import {
  useCreateGoal,
  useDeleteGoal,
  useGoals,
  useUpdateGoal,
  type Goal,
} from "@/hooks/useGoals";
import { usePortfolioXirr } from "@/hooks/usePnl";
import { useLivePrices } from "@/hooks/useLivePrices";
import { useWallet, useWalletHistory } from "@/hooks/useWallet";
import { WalletDialog } from "@/components/WalletDialog";
import { downloadCsv, toCsv } from "@/lib/csv";
import { assetHref, cn, formatCurrency, formatPercent, toNum } from "@/lib/utils";

type TabId =
  | "account"
  | "portfolio"
  | "goals"
  | "orders"
  | "sips"
  | "alerts"
  | "reports"
  | "bank"
  | "security"
  | "preferences"
  | "about";

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: "Account" | "Investing" | "Tools" | "System";
}

const TABS: TabDef[] = [
  { id: "account", label: "Account", icon: User, group: "Account" },
  { id: "security", label: "Security", icon: Shield, group: "Account" },
  { id: "preferences", label: "Preferences", icon: Settings, group: "Account" },
  { id: "portfolio", label: "Portfolio", icon: PieChart, group: "Investing" },
  { id: "goals", label: "Goals", icon: Target, group: "Investing" },
  { id: "orders", label: "Orders", icon: ListOrdered, group: "Investing" },
  { id: "sips", label: "SIPs", icon: CalendarClock, group: "Investing" },
  { id: "alerts", label: "Alerts", icon: Bell, group: "Investing" },
  { id: "reports", label: "Reports", icon: FileText, group: "Tools" },
  { id: "bank", label: "Bank & payments", icon: Landmark, group: "Tools" },
  { id: "about", label: "Help & about", icon: Info, group: "System" },
];

export function ProfilePage() {
  const [tab, setTab] = useState<TabId>("account");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <div className="text-xs uppercase tracking-wider text-fg-muted">
          Settings
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Profile</h1>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <TabSidebar active={tab} onChange={setTab} />
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          className="min-w-0"
        >
          {tab === "account" && <AccountTab />}
          {tab === "security" && <SecurityTab />}
          {tab === "preferences" && <PreferencesTab />}
          {tab === "portfolio" && <PortfolioTab />}
          {tab === "goals" && <GoalsTab />}
          {tab === "orders" && <OrdersTab />}
          {tab === "sips" && <SipsTab />}
          {tab === "alerts" && <AlertsTab />}
          {tab === "reports" && <ReportsTab />}
          {tab === "bank" && <BankTab />}
          {tab === "about" && <AboutTab />}
        </motion.div>
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────

function TabSidebar({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (id: TabId) => void;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, TabDef[]>();
    for (const t of TABS) {
      const arr = m.get(t.group) ?? [];
      arr.push(t);
      m.set(t.group, arr);
    }
    return Array.from(m.entries());
  }, []);

  return (
    <>
      {/* Mobile: horizontal scrolling tab strip. Saves vertical real estate
          and keeps every tab one tap away. */}
      <nav className="card scrollbar-none flex gap-1 overflow-x-auto p-2 lg:hidden">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
              active === t.id
                ? "bg-overlay/5 text-fg"
                : "text-fg-muted hover:bg-overlay/5 hover:text-fg",
            )}
          >
            <t.icon className="h-4 w-4" />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {/* Desktop: grouped vertical sidebar. */}
      <nav className="card hidden h-fit flex-col gap-3 p-3 lg:sticky lg:top-32 lg:flex">
        {groups.map(([group, items]) => (
          <div key={group} className="space-y-0.5">
            <div className="px-2 pb-1 text-[10px] uppercase tracking-wider text-fg-subtle">
              {group}
            </div>
            {items.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onChange(t.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors",
                  active === t.id
                    ? "bg-overlay/5 text-fg"
                    : "text-fg-muted hover:bg-overlay/5 hover:text-fg",
                )}
              >
                <t.icon className="h-4 w-4" />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
    </>
  );
}

// ── Account ──────────────────────────────────────────────────────────────

function AccountTab() {
  const user = useAuth((s) => s.user);
  return (
    <section className="space-y-4">
      <div className="card flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500/30 to-violet-500/30 text-2xl font-semibold">
          {(user?.displayName ?? user?.email ?? "?").slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold">
            {user?.displayName ?? "Investor"}
          </div>
          <div className="text-sm text-fg-muted">{user?.email}</div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="chip text-[10px] text-success border-success/30">
              <ShieldCheck className="h-3 w-3" /> Verified
            </span>
            <span className="chip text-[10px]">Demo / paper trading</span>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <SectionTitle icon={User} title="Personal info" />
        <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <Field label="Display name" value={user?.displayName ?? "—"} />
          <Field label="Email" value={user?.email ?? "—"} mono />
          <Field label="User ID" value={user?.id ?? "—"} mono small />
          <Field
            label="Account type"
            value="Individual · Paper trading"
          />
        </dl>
        <div className="mt-4 rounded-lg border border-border/60 bg-bg-soft/40 p-3 text-[11px] text-fg-muted">
          <Info className="-mt-0.5 mr-1 inline h-3 w-3" />
          Profile editing is read-only here — display name is set at signup. KYC,
          PAN linking, and Aadhaar verification aren't part of this paper-trading
          build.
        </div>
      </div>
    </section>
  );
}

// ── Portfolio ────────────────────────────────────────────────────────────

function PortfolioTab() {
  const portfolios = usePortfolios();
  const portfolio = portfolios.data?.[0];
  const summary = useSummary(portfolio?.id);
  const holdings = useHoldings(portfolio?.id);
  const sips = useSips();
  const alerts = useAlerts();
  const wallet = useWallet();

  const value = toNum(summary.data?.currentValue);
  const invested = toNum(summary.data?.invested);
  const pnl = toNum(summary.data?.pnl);
  const pnlPct = toNum(summary.data?.pnlPercent);
  const cash = toNum(wallet.data?.balance);
  const netWorth = value + cash;

  const counts = useMemo(() => {
    const list = holdings.data ?? [];
    let stocks = 0;
    let funds = 0;
    for (const h of list) {
      if (toNum(h.quantity) <= 0) continue;
      if (h.assetType === "mf") funds++;
      else stocks++;
    }
    const activeSips = (sips.data ?? []).filter((s) => s.status === "active").length;
    const activeAlerts = (alerts.data ?? []).filter((a) => !a.triggered).length;
    return { stocks, funds, activeSips, activeAlerts };
  }, [holdings.data, sips.data, alerts.data]);

  return (
    <section className="space-y-4">
      <div className="card p-5">
        <SectionTitle icon={Wallet2} title="Wallet & portfolio" />
        <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
          <Stat label="Cash balance" value={formatCurrency(cash)} large />
          <Stat label="Portfolio value" value={formatCurrency(value)} large />
          <Stat
            label="Net worth"
            value={formatCurrency(netWorth)}
            tone="pos"
            large
          />
          <Stat label="Invested" value={formatCurrency(invested)} />
          <Stat
            label="P&L"
            value={`${pnl >= 0 ? "+" : ""}${formatCurrency(pnl)}`}
            tone={pnl >= 0 ? "pos" : "neg"}
          />
          <Stat
            label="P&L %"
            value={formatPercent(pnlPct)}
            tone={pnlPct >= 0 ? "pos" : "neg"}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <CountCard
          icon={Briefcase}
          label="Stocks held"
          value={counts.stocks}
          to="/holdings"
        />
        <CountCard
          icon={Coins}
          label="Mutual funds held"
          value={counts.funds}
          to="/holdings"
        />
        <CountCard
          icon={CalendarClock}
          label="Active SIPs"
          value={counts.activeSips}
          to="/sips"
        />
        <CountCard
          icon={Bell}
          label="Active alerts"
          value={counts.activeAlerts}
          to="/alerts"
        />
      </div>
    </section>
  );
}

function CountCard({
  icon: Icon,
  label,
  value,
  to,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="card flex items-center gap-4 p-5 transition-colors hover:border-border-strong"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-overlay/5">
        <Icon className="h-5 w-5 text-fg-muted" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wider text-fg-muted">
          {label}
        </div>
        <div className="num text-2xl font-semibold">{value}</div>
      </div>
      <ArrowRight className="h-4 w-4 text-fg-subtle" />
    </Link>
  );
}

// ── Goals ────────────────────────────────────────────────────────────────

const BUCKETS = [
  { id: "Retirement", label: "Retirement", emoji: "🌴" },
  { id: "Tax saving", label: "Tax saving", emoji: "📊" },
  { id: "Emergency", label: "Emergency", emoji: "🛟" },
  { id: "Trading", label: "Trading", emoji: "📈" },
  { id: "Custom", label: "Custom", emoji: "🎯" },
] as const;

function GoalsTab() {
  const portfolios = usePortfolios();
  const portfolio = portfolios.data?.[0];
  const summary = useSummary(portfolio?.id);
  const xirr = usePortfolioXirr(portfolio?.id);
  const goals = useGoals();
  const remove = useDeleteGoal();
  const [editing, setEditing] = useState<Goal | null>(null);
  const [creating, setCreating] = useState(false);

  const portfolioValue = toNum(summary.data?.currentValue);
  const annualReturn = xirr.data?.insufficient ? 0.10 : (xirr.data?.rate ?? 0.10);

  return (
    <section className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <SectionTitle icon={Target} title="Goals" />
          <p className="mt-2 text-sm text-fg-muted">
            Set a target corpus + deadline. Progress is computed against your
            current portfolio value, with an "on track" verdict using your
            current XIRR projected forward.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="btn-primary text-xs"
          disabled={!portfolio}
        >
          <Plus className="h-3.5 w-3.5" /> New goal
        </button>
      </div>

      {goals.isLoading ? (
        <div className="card flex h-24 items-center justify-center text-sm text-fg-muted">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading goals…
        </div>
      ) : (goals.data ?? []).length === 0 ? (
        <div className="card flex flex-col items-center px-6 py-10 text-center">
          <Target className="h-8 w-8 text-fg-subtle" />
          <p className="mt-3 text-sm text-fg-muted">
            No goals yet. Set one to track your progress toward retirement, a
            tax-saving SIP target, or an emergency-fund corpus.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(goals.data ?? []).map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              portfolioValue={portfolioValue}
              annualReturn={annualReturn}
              onEdit={() => setEditing(g)}
              onDelete={() => {
                if (window.confirm(`Delete goal "${g.name}"?`)) {
                  remove.mutate(g.id);
                }
              }}
            />
          ))}
        </ul>
      )}

      {(creating || editing) && portfolio && (
        <GoalDialog
          portfolioId={portfolio.id}
          existing={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function GoalCard({
  goal,
  portfolioValue,
  annualReturn,
  onEdit,
  onDelete,
}: {
  goal: Goal;
  portfolioValue: number;
  annualReturn: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const target = toNum(goal.targetAmount);
  const progress = target > 0 ? Math.min(1, portfolioValue / target) : 0;
  const targetDate = new Date(goal.targetDate);
  const yearsLeft = Math.max(
    0,
    (targetDate.getTime() - Date.now()) / (365.25 * 24 * 3600 * 1000),
  );
  // Future value of the current portfolio at the user's XIRR. If we'd land
  // below target, we're behind. Tolerate XIRR=0 (no projection — verdict
  // becomes "on track only if already over").
  const projected =
    annualReturn > 0 && yearsLeft > 0
      ? portfolioValue * Math.pow(1 + annualReturn, yearsLeft)
      : portfolioValue;
  const onTrack = projected >= target;
  const bucket = BUCKETS.find((b) => b.id === goal.bucket);

  return (
    <li className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 text-lg">{bucket?.emoji ?? "🎯"}</span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{goal.name}</div>
            <div className="text-[11px] text-fg-muted">
              Target {formatCurrency(target)} ·{" "}
              {targetDate.toLocaleDateString("en-IN", {
                month: "short",
                year: "numeric",
              })}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onEdit}
            className="rounded p-1 text-fg-muted hover:bg-overlay/5 hover:text-fg"
            aria-label="Edit goal"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded p-1 text-fg-muted hover:bg-overlay/5 hover:text-danger"
            aria-label="Delete goal"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-4">
        <div className="h-2 w-full overflow-hidden rounded-full bg-overlay/[0.08]">
          <div
            className={cn(
              "h-full rounded-full",
              onTrack ? "bg-success" : "bg-warn",
            )}
            style={{ width: `${(progress * 100).toFixed(1)}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px]">
          <span className="num text-fg-muted">
            {formatCurrency(portfolioValue)} of {formatCurrency(target)}
          </span>
          <span className="num text-fg-muted">
            {(progress * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Verdict */}
      <div
        className={cn(
          "mt-3 flex items-center justify-between rounded-md border px-2.5 py-1.5 text-[11px]",
          onTrack
            ? "border-success/40 bg-success/10 text-success"
            : "border-warn/40 bg-warn/10 text-warn",
        )}
      >
        <span className="font-medium">
          {onTrack ? "On track" : "Behind target"}
        </span>
        <span className="num">
          projected {formatCurrency(projected)} by{" "}
          {targetDate.getFullYear()}
        </span>
      </div>

      {goal.note && (
        <p className="mt-2 text-[11px] text-fg-subtle">{goal.note}</p>
      )}
    </li>
  );
}

function GoalDialog({
  portfolioId,
  existing,
  onClose,
}: {
  portfolioId: string;
  existing?: Goal;
  onClose: () => void;
}) {
  const create = useCreateGoal();
  const update = useUpdateGoal();
  const [name, setName] = useState(existing?.name ?? "");
  const [target, setTarget] = useState(existing?.targetAmount ?? "1000000");
  const [date, setDate] = useState(
    existing?.targetDate
      ? existing.targetDate.slice(0, 10)
      : defaultGoalDate(),
  );
  const [bucket, setBucket] = useState(existing?.bucket ?? "Retirement");
  const [note, setNote] = useState(existing?.note ?? "");
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    if (!name.trim()) {
      setErr("Goal name is required.");
      return;
    }
    if (toNum(target) <= 0) {
      setErr("Target amount must be greater than 0.");
      return;
    }
    if (!date || new Date(date).getTime() <= Date.now()) {
      setErr("Target date must be in the future.");
      return;
    }
    try {
      if (existing) {
        await update.mutateAsync({
          id: existing.id,
          name,
          targetAmount: target,
          targetDate: date,
          bucket,
          note,
        });
      } else {
        await create.mutateAsync({
          portfolioId,
          name,
          targetAmount: target,
          targetDate: date,
          bucket,
          note,
        });
      }
      onClose();
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md space-y-4 rounded-2xl border border-border bg-bg-card p-5 shadow-glow">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-brand" />
              <h2 className="text-lg font-semibold">
                {existing ? "Edit goal" : "New goal"}
              </h2>
            </div>
            <p className="text-xs text-fg-muted">
              Linked to your active portfolio.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-fg-muted hover:bg-overlay/5 hover:text-fg"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="label">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. House down payment"
              className="input text-sm"
              maxLength={100}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="label">Target ₹</label>
              <input
                type="number"
                inputMode="decimal"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="input num text-sm"
                min="0"
              />
            </div>
            <div className="space-y-1.5">
              <label className="label">By date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="input num text-sm"
                min={new Date().toISOString().slice(0, 10)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="label">Bucket</label>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
              {BUCKETS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBucket(b.id)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-md border p-2 text-[11px] transition-colors",
                    bucket === b.id
                      ? "border-brand bg-brand/10"
                      : "border-border bg-bg-soft hover:border-border-strong",
                  )}
                >
                  <span className="text-base">{b.emoji}</span>
                  <span>{b.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="label">
              Note <span className="text-fg-subtle">(optional)</span>
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. ₹50L by 2030 for a flat in Pune"
              className="input text-sm"
            />
          </div>
        </div>

        {err && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost text-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={create.isPending || update.isPending}
            className="btn-primary text-sm"
          >
            {(create.isPending || update.isPending) && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            {existing ? "Save changes" : "Create goal"}
          </button>
        </div>
      </div>
    </div>
  );
}

function defaultGoalDate(): string {
  // Default 5 years out — long enough that compounding matters, short
  // enough that the verdict isn't trivially "on track".
  const d = new Date();
  d.setFullYear(d.getFullYear() + 5);
  return d.toISOString().slice(0, 10);
}

// ── Orders ───────────────────────────────────────────────────────────────

function OrdersTab() {
  const txns = useTransactions();
  const { quotes } = useLivePrices();
  const recent = (txns.data ?? []).slice(0, 12);

  return (
    <section className="space-y-4">
      <div className="card p-5">
        <SectionTitle
          icon={ListOrdered}
          title="Recent orders"
          right={
            <Link
              to="/transactions"
              className="text-xs text-fg-muted hover:text-fg"
            >
              View all →
            </Link>
          }
        />
        {recent.length === 0 ? (
          <p className="mt-4 text-sm text-fg-muted">
            No orders yet. Place your first trade from any stock or fund page.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border/60">
            {recent.map((t) => {
              const qty = toNum(t.quantity);
              const price = toNum(t.price);
              const total = qty * price;
              const live = quotes[t.ticker];
              const livePrice = live ? toNum(live.price) : 0;
              return (
                <li key={t.id} className="flex items-center gap-3 py-3">
                  <span
                    className={cn(
                      "chip text-[10px]",
                      t.side === "buy"
                        ? "border-success/30 text-success"
                        : "border-danger/30 text-danger",
                    )}
                  >
                    {t.side}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      to={assetHref(t.ticker, t.assetType)}
                      className="truncate text-sm font-medium hover:text-brand"
                    >
                      {t.ticker}
                    </Link>
                    <div className="num text-[11px] text-fg-muted">
                      {qty.toLocaleString()} × {formatCurrency(price)}
                      {livePrice > 0 && (
                        <span className="ml-1.5 text-fg-subtle">
                          · live {formatCurrency(livePrice)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="num text-sm font-medium">
                      {formatCurrency(total)}
                    </div>
                    <div className="text-[10px] text-fg-subtle">
                      {new Date(t.executedAt).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "2-digit",
                      })}
                    </div>
                  </div>
                  <Link
                    to={`/transactions/${t.id}`}
                    className="text-fg-subtle hover:text-fg"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

// ── SIPs ─────────────────────────────────────────────────────────────────

function SipsTab() {
  const sips = useSips();
  const items = sips.data ?? [];
  const active = items.filter((s) => s.status === "active");
  const paused = items.filter((s) => s.status === "paused");
  const lowBalancePaused = items.filter(
    (s) => s.status === "paused" && s.pauseReason === "insufficient_balance",
  );
  const monthly = active.reduce((sum, s) => {
    const a = toNum(s.amount);
    return sum + (s.frequency === "yearly" ? a / 12 : a);
  }, 0);
  const [walletOpen, setWalletOpen] = useState(false);

  return (
    <section className="space-y-4">
      {lowBalancePaused.length > 0 && (
        <div className="card flex flex-wrap items-start justify-between gap-3 border-warn/40 bg-warn/5 p-4">
          <div className="flex items-start gap-3">
            <Wallet2 className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
            <div className="text-sm">
              <div className="font-medium text-fg">
                {lowBalancePaused.length} SIP{lowBalancePaused.length === 1 ? "" : "s"} paused — wallet too low
              </div>
              <p className="mt-0.5 text-[12px] text-fg-muted">
                {lowBalancePaused.map((s) => s.ticker).slice(0, 3).join(", ")}
                {lowBalancePaused.length > 3 && ` +${lowBalancePaused.length - 3} more`}
                . Top up your wallet and resume from the SIPs page.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setWalletOpen(true)}
            className="btn-primary text-xs"
          >
            <Plus className="h-3.5 w-3.5" /> Add funds
          </button>
        </div>
      )}

      <div className="card p-5">
        <SectionTitle
          icon={CalendarClock}
          title="Recurring investments"
          right={
            <Link to="/sips" className="text-xs text-fg-muted hover:text-fg">
              Manage →
            </Link>
          }
        />
        <div className="mt-4 grid grid-cols-3 gap-x-8 gap-y-3 text-sm">
          <Stat label="Active" value={String(active.length)} />
          <Stat label="Paused" value={String(paused.length)} />
          <Stat
            label="Monthly outflow"
            value={formatCurrency(monthly)}
            tone="pos"
          />
        </div>
        {active.length === 0 ? (
          <p className="mt-4 text-sm text-fg-muted">
            No active SIPs. Set one up from any mutual fund page.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border/60">
            {active.slice(0, 6).map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-3">
                <Link
                  to={assetHref(s.ticker, s.assetType)}
                  className="min-w-0 flex-1 truncate text-sm font-medium hover:text-brand"
                >
                  {s.ticker}
                </Link>
                <div className="num text-sm">{formatCurrency(toNum(s.amount))}</div>
                <span className="chip text-[10px]">{s.frequency}</span>
                <div className="text-[10px] text-fg-subtle">
                  next{" "}
                  {new Date(s.nextRunAt).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <WalletDialog open={walletOpen} onOpenChange={setWalletOpen} />
    </section>
  );
}

// ── Alerts ───────────────────────────────────────────────────────────────

function AlertsTab() {
  const alerts = useAlerts();
  const items = alerts.data ?? [];
  const live = items.filter((a) => !a.triggered);
  const fired = items.filter((a) => a.triggered);

  return (
    <section className="space-y-4">
      <div className="card p-5">
        <SectionTitle
          icon={Bell}
          title="Price alerts"
          right={
            <Link to="/alerts" className="text-xs text-fg-muted hover:text-fg">
              Manage →
            </Link>
          }
        />
        <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
          <Stat label="Active" value={String(live.length)} />
          <Stat label="Triggered" value={String(fired.length)} />
          <Stat label="Total" value={String(items.length)} />
        </div>
        {live.length === 0 ? (
          <p className="mt-4 text-sm text-fg-muted">
            No active alerts. Set one from a stock page to get notified when it
            crosses a target.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border/60">
            {live.slice(0, 6).map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-3 text-sm">
                <Link
                  to={`/stock/${a.ticker}`}
                  className="min-w-0 flex-1 truncate font-medium hover:text-brand"
                >
                  {a.ticker}
                </Link>
                <span className="text-fg-muted">
                  {a.direction === "above" ? "≥" : "≤"}
                </span>
                <span className="num">{formatCurrency(toNum(a.targetPrice))}</span>
                <span className="text-[10px] text-fg-subtle">
                  set{" "}
                  {new Date(a.createdAt).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ── Reports ──────────────────────────────────────────────────────────────

function ReportsTab() {
  const portfolios = usePortfolios();
  const portfolio = portfolios.data?.[0];
  const holdings = useHoldings(portfolio?.id);
  const txns = useTransactions();

  function downloadHoldings() {
    const list = holdings.data ?? [];
    const rows: Array<Array<string | number>> = [
      [
        "Ticker",
        "Asset Type",
        "Quantity",
        "Avg Buy Price",
        "Current Price",
        "Invested",
        "Current Value",
        "P&L",
        "P&L %",
      ],
      ...list.map((h) => [
        h.ticker,
        h.assetType,
        h.quantity,
        h.avgBuyPrice,
        h.currentPrice,
        h.invested,
        h.currentValue,
        h.pnl,
        h.pnlPercent,
      ]),
    ];
    downloadCsv(`holdings-${todayStamp()}.csv`, toCsv(rows));
  }

  function downloadTransactions() {
    const list = txns.data ?? [];
    const rows: Array<Array<string | number>> = [
      ["ID", "Date", "Ticker", "Asset Type", "Side", "Quantity", "Price", "Total", "Source"],
      ...list.map((t) => [
        t.id,
        new Date(t.executedAt).toISOString(),
        t.ticker,
        t.assetType,
        t.side,
        t.quantity,
        t.price,
        t.totalAmount,
        t.source ?? "",
      ]),
    ];
    downloadCsv(`transactions-${todayStamp()}.csv`, toCsv(rows));
  }

  return (
    <section className="space-y-4">
      <div className="card p-5">
        <SectionTitle icon={FileText} title="Statements & exports" />
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ReportRow
            title="Holdings statement"
            description={`Current portfolio with P&L. ${(holdings.data ?? []).length} rows.`}
            onClick={downloadHoldings}
            disabled={(holdings.data ?? []).length === 0}
          />
          <ReportRow
            title="Transaction history"
            description={`Every order with executed price. ${(txns.data ?? []).length} rows.`}
            onClick={downloadTransactions}
            disabled={(txns.data ?? []).length === 0}
          />
          <ReportRow
            title="Tax statement (FY)"
            description="Capital gains breakdown by asset and holding period."
            link="/tax"
          />
        </div>
      </div>
    </section>
  );
}

function ReportRow({
  title,
  description,
  onClick,
  link,
  disabled,
}: {
  title: string;
  description: string;
  onClick?: () => void;
  link?: string;
  disabled?: boolean;
}) {
  const inner = (
    <div className="card flex items-start gap-3 p-4">
      <FileText className="mt-0.5 h-4 w-4 text-fg-muted" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-[11px] text-fg-muted">{description}</div>
      </div>
      {link ? (
        <ArrowRight className="h-4 w-4 text-fg-subtle" />
      ) : (
        <Download className={cn("h-4 w-4", disabled ? "text-fg-subtle" : "text-fg-muted")} />
      )}
    </div>
  );
  if (link) return <Link to={link}>{inner}</Link>;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-left disabled:opacity-50"
    >
      {inner}
    </button>
  );
}

// ── Bank & payments ──────────────────────────────────────────────────────

function BankTab() {
  const wallet = useWallet();
  const history = useWalletHistory(20);
  const [dialog, setDialog] = useState<null | "deposit" | "withdraw">(null);

  const balance = toNum(wallet.data?.balance);

  return (
    <section className="space-y-4">
      <div className="card p-5">
        <SectionTitle icon={Wallet2} title="Wallet" />
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-fg-muted">
              Available balance
            </div>
            <div className="num mt-1 text-3xl font-semibold">
              {formatCurrency(balance)}
            </div>
            <div className="mt-1 text-[11px] text-fg-subtle">
              Paper-trading cash · {wallet.data?.currency ?? "INR"}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setDialog("deposit")}
              className="btn-primary"
            >
              <Plus className="h-4 w-4" /> Add funds
            </button>
            <button
              type="button"
              onClick={() => setDialog("withdraw")}
              className="btn-outline"
              disabled={balance <= 0}
            >
              <ArrowUpRight className="h-4 w-4" /> Withdraw
            </button>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <SectionTitle icon={ListOrdered} title="Recent activity" />
        {history.isLoading ? (
          <div className="flex h-16 items-center justify-center text-sm text-fg-muted">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (history.data ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-fg-muted">
            No wallet movements yet. Add funds to get started.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border/60">
            {(history.data ?? []).map((m) => {
              const amt = toNum(m.amount);
              const credit = amt >= 0;
              const Icon = credit ? ArrowDownLeft : ArrowUpRight;
              return (
                <li key={m.id} className="flex items-center gap-3 py-3">
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                      credit
                        ? "bg-success/15 text-success"
                        : "bg-danger/15 text-danger",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium capitalize">
                      {m.kind}
                      {m.method && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-fg-subtle">
                          · {m.method}
                        </span>
                      )}
                    </div>
                    <div className="num text-[11px] text-fg-muted">
                      {m.reference ?? m.note ?? "—"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={cn(
                        "num text-sm font-medium",
                        credit ? "pos" : "neg",
                      )}
                    >
                      {credit ? "+" : ""}
                      {formatCurrency(amt)}
                    </div>
                    <div className="num text-[10px] text-fg-subtle">
                      bal {formatCurrency(toNum(m.balanceAfter))}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="card p-5">
        <SectionTitle icon={Landmark} title="Linked methods" />
        <div className="mt-4 rounded-lg border border-warn/30 bg-warn/5 p-4">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
            <div className="text-sm text-fg">
              <div className="font-medium">Paper trading mode</div>
              <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">
                Deposits, withdrawals, UPI, and bank options here move numbers
                in your wallet — no real banking is connected. Trades execute
                at live market prices and your wallet balance updates exactly
                as it would with a real broker (brokerage + statutory charges
                deducted; sell proceeds credited at execution price).
              </p>
            </div>
          </div>
        </div>
      </div>

      <WalletDialog
        open={dialog !== null}
        onOpenChange={(v) => !v && setDialog(null)}
        defaultMode={dialog ?? "deposit"}
      />
    </section>
  );
}

// ── Security ─────────────────────────────────────────────────────────────

function SecurityTab() {
  const navigate = useNavigate();
  const logout = useAuth((s) => s.logout);

  function onSignOut() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <section className="space-y-4">
      <div className="card p-5">
        <SectionTitle icon={Shield} title="Sign-in & sessions" />
        <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <Field label="Auth method" value="Email + password" />
          <Field label="Token type" value="JWT access + refresh" mono />
          <Field
            label="Session storage"
            value="Browser localStorage (this device)"
          />
          <Field label="Two-factor auth" value="Not enabled" />
        </dl>
      </div>

      <div className="card space-y-3 p-5">
        <SectionTitle icon={KeyRound} title="Password" />
        <div className="rounded-lg border border-border/60 bg-bg-soft/40 p-3 text-[11px] text-fg-muted">
          <Info className="-mt-0.5 mr-1 inline h-3 w-3" />
          In-app password change isn't wired yet. To rotate your password, sign
          out and use the registration flow with a new account, or hit the
          backend's planned <span className="num text-fg">PATCH /me/password</span>{" "}
          endpoint when added.
        </div>
      </div>

      <div className="card p-5">
        <SectionTitle icon={LogOut} title="End session" />
        <p className="mt-2 text-sm text-fg-muted">
          Clears your access + refresh tokens from this device. Live price stream
          disconnects until you sign in again.
        </p>
        <button
          type="button"
          onClick={onSignOut}
          className="btn-outline mt-4 border-danger/40 text-danger hover:bg-danger/10"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </section>
  );
}

// ── Preferences ──────────────────────────────────────────────────────────

function PreferencesTab() {
  return (
    <section className="space-y-4">
      <div className="card p-5">
        <SectionTitle icon={Settings} title="Display" />
        <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <Field label="Theme" value="Dark (only)" />
          <Field label="Currency" value="INR (₹) · en-IN" />
          <Field label="Number format" value="Indian (Lakh / Crore)" />
          <Field
            label="Timezone"
            value={Intl.DateTimeFormat().resolvedOptions().timeZone}
          />
        </dl>
      </div>

      <div className="card p-5">
        <SectionTitle icon={Bell} title="Notifications" />
        <p className="mt-2 text-sm text-fg-muted">
          Alerts trigger in-app via WebSocket and the toaster. Email and push
          notifications aren't wired in this build.
        </p>
      </div>

      <div className="card p-5">
        <SectionTitle icon={Mail} title="Communication" />
        <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <Field label="Marketing emails" value="Off" />
          <Field label="Trade confirmations" value="In-app toast only" />
        </dl>
      </div>
    </section>
  );
}

// ── About ────────────────────────────────────────────────────────────────

function AboutTab() {
  return (
    <section className="space-y-4">
      <div className="card p-5">
        <SectionTitle icon={Info} title="About this build" />
        <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <Field label="Mode" value="Paper trading" />
          <Field
            label="Live data"
            value="Upstox v3 WebSocket · NSE archives · mfapi.in"
          />
          <Field label="Backend" value="Go modular monolith + Postgres" />
          <Field label="Frontend" value="React 18 + Vite + Tailwind" />
        </dl>
        <p className="mt-4 text-[11px] text-fg-subtle">
          Real-time NAVs and stock prices are from public sources. Mutual fund
          data is sourced from AMFI's daily NAV feed via api.mfapi.in. AUM,
          expense ratio, and fund-manager details aren't in that feed; check the
          AMC's factsheet for those.
        </p>
      </div>
    </section>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────

function SectionTitle({
  icon: Icon,
  title,
  right,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-fg-muted" />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-fg-muted">
          {title}
        </h2>
      </div>
      {right}
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  small,
}: {
  label: string;
  value: string;
  mono?: boolean;
  small?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-fg-muted">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5",
          mono && "num",
          small ? "text-[11px] text-fg-muted" : "text-sm",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  large,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
  large?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-fg-muted">
        {label}
      </div>
      <div
        className={cn(
          "num mt-0.5 font-semibold",
          large ? "text-xl" : "text-base",
          tone === "pos" && "pos",
          tone === "neg" && "neg",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function todayStamp(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
