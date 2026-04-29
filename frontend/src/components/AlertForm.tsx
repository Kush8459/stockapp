import { FormEvent, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Bell, Loader2, X } from "lucide-react";
import { useCreateAlert } from "@/hooks/useAlerts";
import { useToast } from "./Toaster";
import { apiErrorMessage } from "@/lib/api";
import { cn, toNum } from "@/lib/utils";

interface AlertFormProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultTicker?: string;
  currentPrice?: number;
}

export function AlertForm({ open, onOpenChange, defaultTicker, currentPrice }: AlertFormProps) {
  const [ticker, setTicker] = useState(defaultTicker ?? "");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [target, setTarget] = useState(currentPrice ? currentPrice.toFixed(2) : "");
  const [err, setErr] = useState<string | null>(null);
  const { push } = useToast();

  const mutation = useCreateAlert();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await mutation.mutateAsync({
        ticker: ticker.toUpperCase().trim(),
        targetPrice: target,
        direction,
      });
      push({
        kind: "success",
        title: "Alert created",
        description: `You'll be notified when ${ticker.toUpperCase()} goes ${direction} ₹${target}.`,
      });
      onOpenChange(false);
    } catch (e2) {
      setErr(apiErrorMessage(e2));
    }
  }

  const distancePct =
    currentPrice && toNum(target) > 0
      ? ((toNum(target) - currentPrice) / currentPrice) * 100
      : null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-bg-card p-6 shadow-glow">
          <div className="flex items-start justify-between">
            <div>
              <Dialog.Title className="flex items-center gap-2 text-xl font-semibold">
                <Bell className="h-5 w-5 text-brand" />
                New price alert
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-fg-muted">
                You'll get a live notification the moment the price crosses your target.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="rounded p-1 text-fg-muted hover:bg-overlay/5 hover:text-fg">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <label className="label">Ticker</label>
              <input
                className="input num uppercase"
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                required
                disabled={!!defaultTicker}
              />
            </div>

            <div className="space-y-1.5">
              <label className="label">Direction</label>
              <div className="grid grid-cols-2 gap-2">
                {(["above", "below"] as const).map((d) => (
                  <button
                    type="button"
                    key={d}
                    onClick={() => setDirection(d)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-sm capitalize transition-colors",
                      direction === d
                        ? "border-brand bg-brand/10 text-fg"
                        : "border-border bg-bg-soft text-fg-muted hover:text-fg",
                    )}
                  >
                    {d === "above" ? "Goes above" : "Drops below"}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="label">Target price</label>
              <input
                className="input num"
                type="number"
                step="any"
                min="0"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                required
              />
              {distancePct !== null && (
                <p
                  className={cn(
                    "num text-[11px]",
                    distancePct >= 0 ? "text-fg-muted" : "text-fg-muted",
                  )}
                >
                  {distancePct >= 0 ? "+" : ""}
                  {distancePct.toFixed(2)}% from current ₹{currentPrice?.toFixed(2)}
                </p>
              )}
            </div>

            {err && (
              <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                {err}
              </div>
            )}

            <button type="submit" className="btn-primary w-full" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create alert
            </button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
