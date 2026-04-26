import { FormEvent, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CalendarClock, Loader2, Sparkles, X } from "lucide-react";
import { usePortfolios } from "@/hooks/usePortfolio";
import { useCreateSip } from "@/hooks/useSips";
import { useLivePrices } from "@/hooks/useLivePrices";
import { useToast } from "./Toaster";
import { TickerPicker } from "./TickerPicker";
import { SipProjectionChart } from "./SipProjectionChart";
import { apiErrorMessage } from "@/lib/api";
import { cn, formatCompact, formatCurrency, formatPercent, toNum } from "@/lib/utils";
import {
  annualContribution,
  nextRunDates,
  sipFutureValue,
  type Frequency,
} from "@/lib/sip";

interface SipFormProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultTicker?: string;
}

const frequencies: Array<{
  value: Frequency;
  label: string;
  note: string;
}> = [
  { value: "daily", label: "Daily", note: "Every 24h" },
  { value: "weekly", label: "Weekly", note: "Every 7d" },
  { value: "monthly", label: "Monthly", note: "Same day" },
];

const amountPresets = [500, 1000, 2500, 5000, 10000];

export function SipForm({ open, onOpenChange, defaultTicker }: SipFormProps) {
  const portfolios = usePortfolios();
  const portfolio = portfolios.data?.[0];
  const [ticker, setTicker] = useState(defaultTicker ?? "");
  const [amount, setAmount] = useState("1000");
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [rate, setRate] = useState(12); // expected annual return, %
  const [err, setErr] = useState<string | null>(null);
  const { push } = useToast();
  const { quotes } = useLivePrices();

  const create = useCreateSip();

  const livePrice = ticker ? toNum(quotes[ticker]?.price) : 0;
  const dayChangePct = ticker ? toNum(quotes[ticker]?.changePct) : 0;
  const amountNum = toNum(amount);
  const unitsPerRun = livePrice > 0 ? amountNum / livePrice : 0;

  const annual = annualContribution(amountNum, frequency);
  const tenYearValue = sipFutureValue(amountNum, frequency, 10, rate / 100);
  const tenYearInvested = annual * 10;
  const tenYearGain = tenYearValue - tenYearInvested;

  const nextRuns = useMemo(
    () => nextRunDates(new Date(), frequency, 3),
    [frequency],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!portfolio) {
      setErr("No portfolio found.");
      return;
    }
    if (!ticker.trim()) {
      setErr("Pick a ticker first.");
      return;
    }
    if (amountNum <= 0) {
      setErr("Amount must be greater than 0.");
      return;
    }
    try {
      await create.mutateAsync({
        portfolioId: portfolio.id,
        ticker: ticker.toUpperCase().trim(),
        assetType: "stock",
        amount,
        frequency,
      });
      push({
        kind: "success",
        title: "SIP created",
        description: `₹${amountNum.toLocaleString("en-IN")} of ${ticker} every ${frequency}.`,
      });
      onOpenChange(false);
    } catch (e2) {
      setErr(apiErrorMessage(e2));
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid max-h-[92vh] w-[94vw] max-w-xl -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_1fr_auto] overflow-hidden rounded-2xl border border-border bg-bg-card shadow-glow">
          <div className="flex items-start justify-between border-b border-border/70 px-6 py-5">
            <div>
              <Dialog.Title className="flex items-center gap-2 text-xl font-semibold">
                <CalendarClock className="h-5 w-5 text-brand" />
                New SIP
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-fg-muted">
                Automate a recurring buy. We'll execute at the live market price each run.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="rounded p-1 text-fg-muted hover:bg-white/5 hover:text-fg">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <form
            id="sip-form"
            onSubmit={onSubmit}
            className="space-y-5 overflow-y-auto px-6 py-5"
          >
            {/* Asset picker + live price */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="label">Asset</label>
                {ticker && livePrice > 0 && (
                  <span className="num text-xs">
                    <span className="text-fg-muted">live </span>
                    <span className="font-medium">{formatCurrency(livePrice)}</span>
                    <span
                      className={cn(
                        "ml-1.5",
                        dayChangePct >= 0 ? "pos" : "neg",
                      )}
                    >
                      {formatPercent(dayChangePct)}
                    </span>
                  </span>
                )}
              </div>
              <TickerPicker value={ticker} onChange={setTicker} />
            </div>

            {/* Amount */}
            <div className="space-y-2">
              <label className="label">Amount per run</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted">
                  ₹
                </span>
                <input
                  className="input num pl-7"
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
              {unitsPerRun > 0 && (
                <div className="num flex items-center gap-1.5 text-[11px] text-fg-muted">
                  <Sparkles className="h-3 w-3 text-brand" />
                  you'll get ≈ <span className="text-fg">{unitsPerRun.toFixed(4)}</span>{" "}
                  units of {ticker} each run
                </div>
              )}
            </div>

            {/* Frequency */}
            <div className="space-y-2">
              <label className="label">Frequency</label>
              <div className="grid grid-cols-3 gap-2">
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

            {/* Next 3 runs preview */}
            <div className="rounded-lg border border-border bg-bg-soft/60 p-3">
              <div className="label mb-2">Next 3 runs</div>
              <ol className="num space-y-1 text-[12px] text-fg-muted">
                <li>
                  <span className="text-fg">now</span> — first auto-execute
                </li>
                {nextRuns.map((d, i) => (
                  <li key={i}>
                    <span className="text-fg">
                      {d.toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>{" "}
                    —{" "}
                    {d.toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
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
                    invested <span className="text-fg">{formatCompact(tenYearInvested)}</span>{" "}
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
              <div className="mt-1 flex items-center gap-4 text-[11px] text-fg-muted">
                <span className="inline-flex items-center gap-1">
                  <span className="h-0.5 w-3 rounded-full bg-cyan-400" /> projected
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-0.5 w-3 rounded-full bg-violet-400 opacity-70" /> invested
                </span>
              </div>
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
              form="sip-form"
              className="btn-primary min-w-40"
              disabled={create.isPending}
            >
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Start SIP
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
