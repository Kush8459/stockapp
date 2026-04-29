import { FormEvent, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Banknote,
  Coins,
  Loader2,
  X,
} from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api";
import { useToast } from "./Toaster";
import { cn, formatCurrency, toNum } from "@/lib/utils";
import type { MfFund } from "@/hooks/useMfCatalog";
import type { Holding } from "@/lib/types";

interface MfRedeemDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fund: MfFund | null;
  holding: Holding | undefined;
  /** Live or latest NAV used to size the redemption. */
  livePrice?: number;
  portfolioId: string;
}

type Mode = "amount" | "units";

export function MfRedeemDialog({
  open,
  onOpenChange,
  fund,
  holding,
  livePrice,
  portfolioId,
}: MfRedeemDialogProps) {
  if (!fund) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid max-h-[92vh] w-[94vw] max-w-xl -translate-x-1/2 -translate-y-1/2 grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr_auto] overflow-hidden rounded-2xl border border-border bg-bg-card shadow-glow">
          <Header fund={fund} onClose={() => onOpenChange(false)} />
          <RedeemPanel
            fund={fund}
            holding={holding}
            livePrice={livePrice}
            portfolioId={portfolioId}
            onDone={() => onOpenChange(false)}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Header({ fund, onClose }: { fund: MfFund; onClose: () => void }) {
  const nav = fund.nav ? toNum(fund.nav.value) : 0;
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/70 px-6 py-5">
      <div className="min-w-0 flex-1">
        <Dialog.Title className="flex items-center gap-2 truncate text-lg font-semibold">
          <ArrowUpRight className="h-5 w-5 text-warn" />
          Redeem · {fund.name}
        </Dialog.Title>
        <Dialog.Description className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
          <span className="chip text-[10px]">{fund.category}</span>
          <span className="truncate">{fund.amc}</span>
          {nav > 0 && (
            <span className="num">
              <span className="text-fg-subtle">NAV </span>
              <span className="text-fg">{formatCurrency(nav)}</span>
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

function RedeemPanel({
  fund,
  holding,
  livePrice,
  portfolioId,
  onDone,
}: {
  fund: MfFund;
  holding: Holding | undefined;
  livePrice?: number;
  portfolioId: string;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const { push } = useToast();

  const heldUnits = toNum(holding?.quantity);
  const avgNav = toNum(holding?.avgBuyPrice);
  const nav = livePrice && livePrice > 0
    ? livePrice
    : toNum(fund.nav?.value) || toNum(holding?.currentPrice);
  const value = heldUnits * nav;
  const invested = heldUnits * avgNav;
  const pnl = value - invested;
  const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;

  const [mode, setMode] = useState<Mode>("amount");
  const [amount, setAmount] = useState("");
  const [units, setUnits] = useState("");
  const [err, setErr] = useState<string | null>(null);

  // Default the amount to ~25% of position (a sensible partial redemption).
  useEffect(() => {
    if (heldUnits <= 0 || nav <= 0) return;
    const partial = Math.round(heldUnits * nav * 0.25);
    setAmount(String(Math.max(100, partial)));
  }, [heldUnits, nav]);

  /**
   * Sanitize a numeric input so the field can't accept malformed shapes
   * ("015") and can't exceed the allowed max. Empty stays empty so the
   * placeholder/clearing UX still works. Truncates (floor) rather than
   * rounding when clamping — toFixed can otherwise round up and emit a
   * value above the cap.
   */
  function sanitize(raw: string, max: number): string {
    if (raw === "") return "";
    const stripped = raw.replace(/^0+(?=\d)/, "");
    const parsed = parseFloat(stripped);
    if (!Number.isFinite(parsed) || parsed < 0) return "";
    if (max > 0 && parsed > max) {
      // Floor-truncate to 8 dp (matches our DB precision for units), then
      // strip trailing zeros so the field reads cleanly.
      const truncated = Math.floor(max * 1e8) / 1e8;
      return String(truncated);
    }
    return stripped;
  }

  // Derive the dependent figure based on the input mode.
  const amountNum = toNum(amount);
  const unitsNum = toNum(units);
  const sellUnits = mode === "amount"
    ? (nav > 0 ? amountNum / nav : 0)
    : unitsNum;
  const sellAmount = mode === "amount" ? amountNum : unitsNum * nav;
  const fullRedeem = sellUnits >= heldUnits - 0.0001;

  const sell = useMutation({
    mutationFn: async () => {
      // Cap at heldUnits so the user can never overshoot due to NAV rounding.
      const qty = Math.min(sellUnits, heldUnits).toFixed(8);
      const { data } = await api.post("/transactions", {
        portfolioId,
        ticker: fund.ticker,
        assetType: "mf",
        side: "sell",
        quantity: qty,
        price: nav.toFixed(4),
        note: `Redeem · ${fund.name}`,
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
        title: "Redemption placed",
        description: `${sellUnits.toFixed(4)} units → ${formatCurrency(sellAmount)} from ${fund.amc}`,
      });
      onDone();
    },
    onError: (e) => setErr(apiErrorMessage(e)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (heldUnits <= 0) {
      setErr("You don't hold any units of this fund.");
      return;
    }
    if (nav <= 0) {
      setErr("NAV unavailable for this fund right now. Try again in a minute.");
      return;
    }
    if (sellUnits <= 0) {
      setErr("Enter an amount or unit count to redeem.");
      return;
    }
    if (sellUnits > heldUnits + 0.0001) {
      setErr(`You only hold ${heldUnits.toFixed(4)} units.`);
      return;
    }
    sell.mutate();
  }

  return (
    <>
      <form
        id="mf-redeem-form"
        onSubmit={onSubmit}
        noValidate
        className="space-y-5 overflow-y-auto px-6 py-5 scrollbar-none"
      >
        {/* Position snapshot */}
        <div className="rounded-xl border border-border bg-bg-soft/60 p-4">
          <div className="label mb-2">Your position</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <Stat label="Units" value={heldUnits.toFixed(4)} />
            <Stat label="Avg NAV" value={formatCurrency(avgNav)} />
            <Stat label="Value" value={formatCurrency(value)} />
            <Stat
              label="P&L"
              value={`${pnl >= 0 ? "+" : ""}${formatCurrency(pnl)}`}
              tone={pnl >= 0 ? "pos" : "neg"}
              hint={`${pnl >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%`}
            />
          </div>
        </div>

        {/* Mode toggle */}
        <div className="space-y-2">
          <label className="label">Redeem by</label>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-bg-soft p-0.5 w-fit">
            <ModeBtn
              active={mode === "amount"}
              onClick={() => setMode("amount")}
              icon={<Banknote className="h-3.5 w-3.5" />}
              label="Amount (₹)"
            />
            <ModeBtn
              active={mode === "units"}
              onClick={() => setMode("units")}
              icon={<Coins className="h-3.5 w-3.5" />}
              label="Units"
            />
          </div>
        </div>

        {/* Input */}
        {mode === "amount" ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="label">Amount</label>
              <button
                type="button"
                onClick={() => setAmount(value.toFixed(2))}
                className="text-[11px] text-brand hover:underline"
              >
                Redeem all · {formatCurrency(value)}
              </button>
            </div>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted">
                ₹
              </span>
              <input
                className="input num pl-7 text-lg"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={amount}
                onChange={(e) => setAmount(sanitize(e.target.value, value))}
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[0.25, 0.5, 0.75, 1].map((frac) => {
                const v = Math.floor(value * frac);
                if (v < 100) return null;
                return (
                  <button
                    key={frac}
                    type="button"
                    onClick={() => setAmount(String(v))}
                    className={cn(
                      "num rounded-full border px-2.5 py-1 text-xs transition-colors",
                      Math.abs(toNum(amount) - v) < 1
                        ? "border-brand bg-brand/10 text-fg"
                        : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
                    )}
                  >
                    {frac === 1 ? "All" : `${Math.round(frac * 100)}%`}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="label">Units</label>
              <button
                type="button"
                onClick={() => setUnits(heldUnits.toFixed(4))}
                className="text-[11px] text-brand hover:underline"
              >
                Sell all · {heldUnits.toFixed(4)} units
              </button>
            </div>
            <input
              className="input num text-lg"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={units}
              onChange={(e) => setUnits(sanitize(e.target.value, heldUnits))}
            />
          </div>
        )}

        {/* Outcome card — always shown so the layout stays stable as the
            user toggles modes or clears the input. Values are 0 until
            something is entered. */}
        <div className="rounded-xl border border-border bg-bg-soft/60 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="label">You'll receive</div>
              <div
                className={cn(
                  "num mt-1 text-2xl font-semibold",
                  sellAmount <= 0 && "text-fg-subtle",
                )}
              >
                {formatCurrency(sellAmount)}
              </div>
              <div className="mt-1 text-[11px] text-fg-muted">
                by selling{" "}
                <span className="num text-fg">{sellUnits.toFixed(4)}</span>{" "}
                units at NAV {nav > 0 ? formatCurrency(nav) : "—"}
                {fullRedeem && sellUnits > 0 && (
                  <span className="ml-1 text-warn">· full redemption</span>
                )}
              </div>
            </div>
            <ArrowUpRight
              className={cn(
                "h-6 w-6",
                sellAmount > 0 ? "text-warn" : "text-fg-subtle",
              )}
            />
          </div>
          {avgNav > 0 && (
            <div className="num mt-3 border-t border-border/60 pt-2 text-[11px] text-fg-muted">
              Realised P&L on this redemption:{" "}
              {sellUnits > 0 ? (
                <span className={cn(sellAmount - sellUnits * avgNav >= 0 ? "pos" : "neg")}>
                  {sellAmount - sellUnits * avgNav >= 0 ? "+" : ""}
                  {formatCurrency(sellAmount - sellUnits * avgNav)}
                </span>
              ) : (
                <span className="text-fg-subtle">—</span>
              )}
            </div>
          )}
        </div>

        {err && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {err}
          </div>
        )}
      </form>

      <div className="flex items-center justify-between gap-3 border-t border-border/70 bg-bg-card px-6 py-4">
        <div className="text-[11px] text-fg-muted">
          Settles T+1 in real broker · T+0 here
        </div>
        <button
          type="submit"
          form="mf-redeem-form"
          className="btn-primary min-w-40 bg-warn text-bg-card hover:bg-warn/90"
          disabled={sell.isPending || sellUnits <= 0 || sellUnits > heldUnits + 0.0001 || nav <= 0}
        >
          {sell.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Redeem {sellAmount > 0 ? formatCurrency(sellAmount) : ""}
        </button>
      </div>
    </>
  );
}

function ModeBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
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
    </button>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
  hint?: string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-fg-muted">
        {label}
      </div>
      <div
        className={cn(
          "num mt-0.5 text-sm font-medium",
          tone === "pos" && "pos",
          tone === "neg" && "neg",
        )}
      >
        {value}
      </div>
      {hint && (
        <div className={cn("num text-[10px]", tone === "pos" && "pos", tone === "neg" && "neg")}>
          {hint}
        </div>
      )}
    </div>
  );
}
