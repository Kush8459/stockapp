import { FormEvent, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Clock,
  Loader2,
  Sparkles,
  Wallet2,
  X,
} from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api";
import { usePortfolios } from "@/hooks/usePortfolio";
import { useCreateSip } from "@/hooks/useSips";
import { useWallet } from "@/hooks/useWallet";
import { useToast } from "./Toaster";
import { SipProjectionChart } from "./SipProjectionChart";
import { cn, formatCompact, formatCurrency, toNum } from "@/lib/utils";
import {
  annualContribution,
  nextRunDates,
  sipFutureValue,
  sipInvested,
  startDateToFirstRunAt,
  todayLocalISODate,
  type Frequency,
} from "@/lib/sip";
import type { MfFund } from "@/hooks/useMfCatalog";

interface MfInvestDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fund: MfFund | null;
  defaultMode?: "lumpsum" | "sip";
}

const amountPresets = [500, 1000, 2500, 5000, 10000, 25000];

const frequencies: Array<{ value: Frequency; label: string; note: string }> = [
  { value: "monthly", label: "Monthly", note: "Same day each month" },
  { value: "yearly", label: "Yearly", note: "Same day each year" },
];

export function MfInvestDialog({
  open,
  onOpenChange,
  fund,
  defaultMode = "lumpsum",
}: MfInvestDialogProps) {
  const [mode, setMode] = useState<"lumpsum" | "sip">(defaultMode);

  if (!fund) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid max-h-[92vh] w-[94vw] max-w-xl -translate-x-1/2 -translate-y-1/2 grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_1fr_auto] overflow-hidden rounded-2xl border border-border bg-bg-card shadow-glow">
          <Header fund={fund} onClose={() => onOpenChange(false)} />

          {/* mode toggle */}
          <div className="border-b border-border/70 px-6 pt-4">
            <div className="flex items-center gap-1 rounded-lg border border-border bg-bg-soft p-0.5 w-fit">
              <ModeButton
                active={mode === "lumpsum"}
                onClick={() => setMode("lumpsum")}
                icon={<Wallet2 className="h-3.5 w-3.5" />}
                label="Lumpsum"
                note="One-time"
              />
              <ModeButton
                active={mode === "sip"}
                onClick={() => setMode("sip")}
                icon={<CalendarClock className="h-3.5 w-3.5" />}
                label="SIP"
                note="Recurring"
              />
            </div>
          </div>

          {mode === "lumpsum" ? (
            <LumpsumPanel fund={fund} onDone={() => onOpenChange(false)} />
          ) : (
            <SipPanel fund={fund} onDone={() => onOpenChange(false)} />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Header({ fund, onClose }: { fund: MfFund; onClose: () => void }) {
  const nav = fund.nav ? toNum(fund.nav.value) : 0;
  const changePct = fund.nav?.changePct ? toNum(fund.nav.changePct) : 0;
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/70 px-6 py-5">
      <div className="min-w-0 flex-1">
        <Dialog.Title className="truncate text-lg font-semibold">
          {fund.name}
        </Dialog.Title>
        <Dialog.Description className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
          <span className="chip text-[10px]">{fund.category}</span>
          <span className="truncate">{fund.amc}</span>
          {nav > 0 && (
            <span className="num">
              <span className="text-fg-subtle">NAV </span>
              <span className="text-fg">{formatCurrency(nav)}</span>
              {fund.nav?.changePct && (
                <span className={cn("ml-1.5", changePct >= 0 ? "pos" : "neg")}>
                  {changePct >= 0 ? "+" : ""}
                  {changePct.toFixed(2)}%
                </span>
              )}
            </span>
          )}
        </Dialog.Description>
      </div>
      <Dialog.Close asChild>
        <button
          onClick={onClose}
          className="rounded p-1 text-fg-muted hover:bg-overlay/5 hover:text-fg"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </Dialog.Close>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
  note,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  note: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
        active ? "bg-overlay/10 text-fg" : "text-fg-muted hover:text-fg",
      )}
    >
      {icon}
      <span>{label}</span>
      <span className="text-[10px] text-fg-subtle">· {note}</span>
    </button>
  );
}

// ── Lumpsum tab ─────────────────────────────────────────────────────────

function LumpsumPanel({ fund, onDone }: { fund: MfFund; onDone: () => void }) {
  const portfolios = usePortfolios();
  const portfolio = portfolios.data?.[0];
  const wallet = useWallet();
  const qc = useQueryClient();
  const { push } = useToast();
  const [amount, setAmount] = useState("5000");
  const [err, setErr] = useState<string | null>(null);

  const nav = fund.nav ? toNum(fund.nav.value) : 0;
  const amountNum = toNum(amount);
  const units = nav > 0 ? amountNum / nav : 0;
  const balance = toNum(wallet.data?.balance);
  const overBalance = amountNum > balance;

  const buy = useMutation({
    mutationFn: async () => {
      const { data } = await api.post("/transactions", {
        portfolioId: portfolio?.id,
        ticker: fund.ticker,
        assetType: "mf",
        side: "buy",
        quantity: units.toFixed(8),
        price: nav.toFixed(4),
        note: `Lumpsum · ${fund.name}`,
      });
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["holdings"] }),
        qc.invalidateQueries({ queryKey: ["summary"] }),
        qc.invalidateQueries({ queryKey: ["transactions"] }),
        qc.invalidateQueries({ queryKey: ["xirr"] }),
        qc.invalidateQueries({ queryKey: ["wallet"] }),
        qc.invalidateQueries({ queryKey: ["wallet-history"] }),
      ]);
      push({
        kind: "success",
        title: "Investment placed",
        description: `${formatCurrency(amountNum)} → ${units.toFixed(4)} units of ${fund.amc}`,
      });
      onDone();
    },
    onError: (e) => setErr(apiErrorMessage(e)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!portfolio) {
      setErr("No portfolio found.");
      return;
    }
    if (nav <= 0) {
      setErr("NAV unavailable for this fund right now. Try again in a minute.");
      return;
    }
    if (amountNum < 100) {
      setErr("Minimum lumpsum is ₹100.");
      return;
    }
    if (overBalance) {
      setErr(
        `Need ${formatCurrency(amountNum)} but wallet has ${formatCurrency(balance)}. Deposit funds or reduce the amount.`,
      );
      return;
    }
    buy.mutate();
  }

  return (
    <>
      <form
        id="mf-lumpsum-form"
        onSubmit={onSubmit}
        className="space-y-5 overflow-y-auto px-6 py-5"
      >
        <AmountField amount={amount} setAmount={setAmount} />

        {nav > 0 ? (
          <div className="rounded-xl border border-border bg-bg-soft/60 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="label">You'll get</div>
                <div className="num mt-1 text-2xl font-semibold">
                  {units.toFixed(4)}
                  <span className="ml-1 text-sm font-normal text-fg-muted">units</span>
                </div>
                <div className="mt-1 text-[11px] text-fg-muted">
                  at NAV {formatCurrency(nav)} · settles T+1 in real broker, T+0 here
                </div>
              </div>
              <Sparkles className="h-6 w-6 text-brand" />
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2 text-[11px]">
              <span className="text-fg-subtle">Wallet balance</span>
              <span
                className={cn(
                  "num",
                  overBalance ? "text-danger" : "text-fg-muted",
                )}
              >
                {formatCurrency(balance)}
              </span>
            </div>
            <div className="text-[11px] text-fg-subtle">
              Direct plan — no brokerage or statutory charges.
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
            NAV not available yet. The price worker fetches NAVs every 30 min;
            try again shortly.
          </div>
        )}

        {err && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {err}
          </div>
        )}
      </form>

      <div className="flex items-center justify-between gap-3 border-t border-border/70 bg-bg-card px-6 py-4">
        <div className="text-[11px] text-fg-muted">
          <Clock className="-mt-0.5 mr-1 inline h-3 w-3" />
          One-time · {fund.planType} Plan · Growth
        </div>
        <button
          type="submit"
          form="mf-lumpsum-form"
          className="btn-primary min-w-40"
          disabled={buy.isPending || overBalance || amountNum < 100}
        >
          {buy.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Invest {formatCurrency(amountNum)}
        </button>
      </div>
    </>
  );
}

// ── SIP tab ─────────────────────────────────────────────────────────────

function SipPanel({ fund, onDone }: { fund: MfFund; onDone: () => void }) {
  const portfolios = usePortfolios();
  const portfolio = portfolios.data?.[0];
  const create = useCreateSip();
  const { push } = useToast();
  const [amount, setAmount] = useState("2500");
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [startDate, setStartDate] = useState<string>(todayLocalISODate());
  const [rate, setRate] = useState(12);
  const [err, setErr] = useState<string | null>(null);

  const amountNum = toNum(amount);
  const annual = annualContribution(amountNum, frequency);
  const tenYearValue = sipFutureValue(amountNum, frequency, 10, rate / 100);
  const tenYearInvested = sipInvested(amountNum, frequency, 10);
  const tenYearGain = tenYearValue - tenYearInvested;

  const startDateObj = useMemo(
    () => (startDate ? new Date(`${startDate}T00:00:00`) : new Date()),
    [startDate],
  );
  const upcoming = useMemo(
    () => nextRunDates(startDateObj, frequency, 3),
    [startDateObj, frequency],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!portfolio) {
      setErr("No portfolio found.");
      return;
    }
    if (amountNum < 100) {
      setErr("Minimum SIP amount is ₹100.");
      return;
    }
    try {
      await create.mutateAsync({
        portfolioId: portfolio.id,
        ticker: fund.ticker,
        assetType: "mf",
        amount,
        frequency,
        firstRunAt: startDateToFirstRunAt(startDate),
      });
      push({
        kind: "success",
        title: "SIP started",
        description: `${formatCurrency(amountNum)} ${frequency} into ${fund.amc}`,
      });
      onDone();
    } catch (e2) {
      setErr(apiErrorMessage(e2));
    }
  }

  return (
    <>
      <form
        id="mf-sip-form"
        onSubmit={onSubmit}
        className="space-y-5 overflow-y-auto px-6 py-5"
      >
        <AmountField amount={amount} setAmount={setAmount} label="Amount per run" />

        {/* Frequency picker */}
        <div className="space-y-2">
          <label className="label">Frequency</label>
          <div className="grid grid-cols-2 gap-2">
            {frequencies.map((f) => (
              <button
                type="button"
                key={f.value}
                onClick={() => setFrequency(f.value)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  frequency === f.value
                    ? "border-brand bg-brand/10"
                    : "border-border bg-bg-soft hover:border-border-strong",
                )}
              >
                <div className="text-sm font-medium">{f.label}</div>
                <div className="text-[11px] text-fg-muted">{f.note}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Start date */}
        <div className="space-y-2">
          <label className="label" htmlFor="mf-sip-start-date">
            Start date
          </label>
          <input
            id="mf-sip-start-date"
            type="date"
            className="input num"
            min={todayLocalISODate()}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <p className="text-[11px] text-fg-subtle">
            {startDate === todayLocalISODate()
              ? "Runs immediately, then every period."
              : `First run scheduled for ${startDateObj.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}.`}
          </p>
        </div>

        {/* Upcoming runs */}
        <div className="rounded-lg border border-border bg-bg-soft/60 p-3">
          <div className="label mb-2">Next 3 runs</div>
          <ol className="num space-y-1 text-[12px] text-fg-muted">
            <li>
              <span className="text-fg">
                {startDateObj.toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              </span>{" "}
              — first run
            </li>
            {upcoming.map((d, i) => (
              <li key={i}>
                <span className="text-fg">
                  {d.toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </li>
            ))}
          </ol>
        </div>

        {/* Projection */}
        <div className="rounded-xl border border-border bg-bg-soft/60 p-4">
          <div className="mb-2 flex items-end justify-between gap-2">
            <div>
              <div className="label">10-year projection</div>
              <div className="num mt-1 text-2xl font-semibold">
                {formatCompact(tenYearValue)}
              </div>
              <div className="num text-[11px] text-fg-muted">
                invested{" "}
                <span className="text-fg">{formatCompact(tenYearInvested)}</span>{" "}
                · gain{" "}
                <span className={tenYearGain >= 0 ? "pos" : "neg"}>
                  {formatCompact(tenYearGain)}
                </span>
              </div>
            </div>
            <div className="w-40">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-fg-muted">
                  Return
                </span>
                <span className="num text-xs font-medium text-brand">{rate}%</span>
              </div>
              <input
                type="range"
                min={4}
                max={20}
                step={0.5}
                value={rate}
                onChange={(e) => setRate(parseFloat(e.target.value))}
                className="mt-1 w-full accent-brand"
              />
            </div>
          </div>
          <SipProjectionChart
            amount={amountNum}
            frequency={frequency}
            annualRate={rate / 100}
          />
        </div>

        {err && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {err}
          </div>
        )}
      </form>

      <div className="flex items-center justify-between gap-3 border-t border-border/70 bg-bg-card px-6 py-4">
        <div className="text-[11px] text-fg-muted">
          <span className="text-fg">{formatCurrency(annual)}</span> / year committed
        </div>
        <button
          type="submit"
          form="mf-sip-form"
          className="btn-primary min-w-40"
          disabled={create.isPending}
        >
          {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Start SIP
        </button>
      </div>
    </>
  );
}

function AmountField({
  amount,
  setAmount,
  label = "Amount",
}: {
  amount: string;
  setAmount: (v: string) => void;
  label?: string;
}) {
  const amountNum = toNum(amount);
  return (
    <div className="space-y-2">
      <label className="label">{label}</label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted">
          ₹
        </span>
        <input
          className="input num pl-7 text-lg"
          type="number"
          step="any"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {amountPresets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setAmount(String(p))}
            className={cn(
              "num rounded-full border px-2.5 py-1 text-xs transition-colors",
              amountNum === p
                ? "border-brand bg-brand/10 text-fg"
                : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
            )}
          >
            ₹{p.toLocaleString("en-IN")}
          </button>
        ))}
      </div>
    </div>
  );
}
