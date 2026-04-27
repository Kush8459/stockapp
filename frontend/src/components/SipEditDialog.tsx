import { FormEvent, useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, Pencil, X } from "lucide-react";
import { useUpdateSip, type SipPlan } from "@/hooks/useSips";
import { apiErrorMessage } from "@/lib/api";
import { useToast } from "./Toaster";
import { cn, formatCurrency, toNum } from "@/lib/utils";
import { startDateToFirstRunAt, todayLocalISODate } from "@/lib/sip";

// Frequencies the edit dialog can save. Narrower than `lib/sip.Frequency`
// because the API rejects daily/weekly for new/updated plans.
type EditableFrequency = "monthly" | "yearly";

interface SipEditDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  plan: SipPlan | null;
}

const frequencies: Array<{ value: EditableFrequency; label: string; note: string }> = [
  { value: "monthly", label: "Monthly", note: "Same day each month" },
  { value: "yearly", label: "Yearly", note: "Same day each year" },
];

const amountPresets = [500, 1000, 2500, 5000, 10000, 25000];

/**
 * Edit a running SIP. Lets the user change amount, frequency, and the
 * next run date. Status changes (pause/resume/cancel) live on the row
 * itself — different shape of action, kept off this surface to avoid
 * combining "fix a typo" with "stop the plan".
 */
export function SipEditDialog({ open, onOpenChange, plan }: SipEditDialogProps) {
  const update = useUpdateSip();
  const { push } = useToast();

  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<EditableFrequency>("monthly");
  // YYYY-MM-DD for the date input. Only relevant for editing; users who
  // just want to change amount/frequency can leave the date as-is.
  const [nextRunDate, setNextRunDate] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  // Re-seed the form whenever the dialog opens for a new plan.
  useEffect(() => {
    if (!plan || !open) return;
    setAmount(plan.amount);
    // The plan's stored frequency might be a legacy daily/weekly; coerce
    // anything outside our two-value picker to monthly so the user can
    // explicitly opt back into one of the supported cadences.
    setFrequency(
      plan.frequency === "monthly" || plan.frequency === "yearly"
        ? plan.frequency
        : "monthly",
    );
    setNextRunDate(plan.nextRunAt.slice(0, 10));
    setErr(null);
  }, [plan, open]);

  const amountNum = toNum(amount);
  const minDate = todayLocalISODate();

  const original = useMemo(() => {
    if (!plan) return null;
    return {
      amount: plan.amount,
      frequency: plan.frequency,
      nextRunAt: plan.nextRunAt.slice(0, 10),
    };
  }, [plan]);

  const dirty = useMemo(() => {
    if (!original) return false;
    return (
      String(amountNum) !== String(toNum(original.amount)) ||
      frequency !== original.frequency ||
      nextRunDate !== original.nextRunAt
    );
  }, [original, amountNum, frequency, nextRunDate]);

  if (!plan) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!plan) return;
    setErr(null);
    if (amountNum < 100) {
      setErr("Minimum SIP amount is ₹100.");
      return;
    }
    const body: Parameters<typeof update.mutateAsync>[0] = { id: plan.id };
    if (String(amountNum) !== String(toNum(plan.amount))) {
      body.amount = amount;
    }
    if (frequency !== plan.frequency) {
      body.frequency = frequency;
    }
    if (nextRunDate && nextRunDate !== plan.nextRunAt.slice(0, 10)) {
      body.nextRunAt = startDateToFirstRunAt(nextRunDate);
    }
    if (!body.amount && !body.frequency && !body.nextRunAt) {
      onOpenChange(false);
      return;
    }
    try {
      await update.mutateAsync(body);
      push({
        kind: "success",
        title: "SIP updated",
        description: `${plan.ticker} now ${formatCurrency(amountNum)} ${frequency}`,
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
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid max-h-[92vh] w-[94vw] max-w-md -translate-x-1/2 -translate-y-1/2 grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr_auto] overflow-hidden rounded-2xl border border-border bg-bg-card shadow-glow">
          <div className="flex items-start justify-between gap-3 border-b border-border/70 px-6 py-5">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="flex items-center gap-2 text-lg font-semibold">
                <Pencil className="h-4 w-4 text-brand" />
                Edit SIP
              </Dialog.Title>
              <Dialog.Description className="mt-1 truncate text-xs text-fg-muted">
                {plan.ticker} · {plan.assetType.toUpperCase()}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="rounded p-1 text-fg-muted hover:bg-white/5 hover:text-fg">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <form
            id="sip-edit-form"
            onSubmit={onSubmit}
            className="space-y-5 overflow-y-auto px-6 py-5"
          >
            {/* Amount */}
            <div className="space-y-2">
              <label className="label">Amount per run</label>
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

            {/* Frequency */}
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
              {plan.frequency !== "monthly" && plan.frequency !== "yearly" && (
                <p className="text-[11px] text-warn">
                  This plan was created on the legacy {plan.frequency} cadence.
                  Saving will migrate it to monthly or yearly.
                </p>
              )}
            </div>

            {/* Next run date */}
            <div className="space-y-2">
              <label className="label" htmlFor="sip-next-run">
                Next run
              </label>
              <input
                id="sip-next-run"
                type="date"
                className="input num"
                min={minDate}
                value={nextRunDate}
                onChange={(e) => setNextRunDate(e.target.value)}
              />
              <p className="text-[11px] text-fg-subtle">
                The scheduler will fire on this date and step forward every
                period after.
              </p>
            </div>

            {err && (
              <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                {err}
              </div>
            )}
          </form>

          <div className="flex items-center justify-end gap-2 border-t border-border/70 bg-bg-card px-6 py-4">
            <Dialog.Close asChild>
              <button type="button" className="btn-ghost text-sm">
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="submit"
              form="sip-edit-form"
              className="btn-primary min-w-32"
              disabled={update.isPending || !dirty}
            >
              {update.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save changes
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
