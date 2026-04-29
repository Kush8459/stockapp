import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Loader2, X } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api";
import { cn, formatCurrency, formatPercent, toNum } from "@/lib/utils";
import { computeCharges, netAmount } from "@/lib/charges";
import { useWallet } from "@/hooks/useWallet";
import type { Holding, Transaction } from "@/lib/types";
import { useToast } from "./Toaster";

export interface TradeDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  portfolioId: string;
  ticker: string;
  side: "buy" | "sell";
  assetType?: "stock" | "mf";
  /** Current holding for this ticker, if one exists. */
  holding?: Holding;
  /** Current live market price (WS) or most recent REST price. */
  livePrice?: number;
}

export function TradeDialog({
  open,
  onOpenChange,
  portfolioId,
  ticker,
  side,
  assetType = "stock",
  holding,
  livePrice,
}: TradeDialogProps) {
  const [qty, setQty] = useState(side === "sell" ? "" : "1");
  const [price, setPrice] = useState(livePrice ? livePrice.toFixed(2) : "");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const priceTouched = useRef(false);
  const qc = useQueryClient();
  const { push: pushToast } = useToast();

  // Keep the price input tracking live ticks until the user types into it —
  // gives the "price is actually live" feel without overwriting user edits.
  useEffect(() => {
    if (priceTouched.current || !livePrice) return;
    setPrice(livePrice.toFixed(2));
  }, [livePrice]);

  const availableQty = toNum(holding?.quantity);
  const avg = toNum(holding?.avgBuyPrice);
  const market = livePrice ?? toNum(holding?.currentPrice);
  const position = availableQty > 0;
  const positionValue = availableQty * market;
  const positionInvested = availableQty * avg;
  const positionPnl = positionValue - positionInvested;
  const positionPnlPct = positionInvested > 0 ? (positionPnl / positionInvested) * 100 : 0;

  const parsedQty = toNum(qty);
  const parsedPrice = toNum(price);
  const total = parsedQty * parsedPrice;

  const charges = useMemo(
    () => computeCharges(assetType, side, parsedQty, parsedPrice),
    [assetType, side, parsedQty, parsedPrice],
  );
  const net = useMemo(
    () => netAmount(side, parsedQty, parsedPrice, charges),
    [side, parsedQty, parsedPrice, charges],
  );

  // Wallet balance gate. Buys must fit; sells don't read it (proceeds are
  // credited, not deducted).
  const wallet = useWallet();
  const balance = toNum(wallet.data?.balance);
  const overBalance = side === "buy" && parsedQty > 0 && net > balance;

  const inlineError = useMemo(() => {
    if (parsedQty <= 0) return null;
    if (side === "sell") {
      if (!position) return "You don't own any of this asset yet.";
      if (parsedQty > availableQty)
        return `You only have ${availableQty.toLocaleString()} available.`;
    }
    if (overBalance) {
      return `Need ${formatCurrency(net)} but wallet has ${formatCurrency(balance)}. Deposit funds or reduce the order.`;
    }
    return null;
  }, [parsedQty, side, position, availableQty, overBalance, net, balance]);

  const mutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<Transaction>("/transactions", {
        portfolioId,
        ticker,
        assetType,
        side,
        quantity: qty,
        price,
        note: note.trim() || undefined,
      });
      return data;
    },
    onSuccess: async (txn) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["holdings"] }),
        qc.invalidateQueries({ queryKey: ["summary"] }),
        qc.invalidateQueries({ queryKey: ["transactions"] }),
        qc.invalidateQueries({ queryKey: ["xirr"] }),
        qc.invalidateQueries({ queryKey: ["wallet"] }),
        qc.invalidateQueries({ queryKey: ["wallet-history"] }),
      ]);
      pushToast({
        kind: "success",
        title: `${side === "buy" ? "Bought" : "Sold"} ${txn.quantity} ${txn.ticker}`,
        description: `Executed at ${formatCurrency(toNum(txn.price))} · total ${formatCurrency(toNum(txn.totalAmount))}`,
      });
      onOpenChange(false);
    },
    onError: (e) => setErr(apiErrorMessage(e)),
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (inlineError) {
      setErr(inlineError);
      return;
    }
    if (parsedQty <= 0) {
      setErr("Quantity must be greater than 0.");
      return;
    }
    if (parsedPrice < 0) {
      setErr("Price must be zero or more.");
      return;
    }
    mutation.mutate();
  }

  const Icon = side === "buy" ? ArrowDownLeft : ArrowUpRight;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content className="scrollbar-none fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-bg-card p-6 shadow-glow">
          <div className="flex items-start justify-between">
            <div>
              <Dialog.Title className="flex items-center gap-2 text-xl font-semibold">
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-lg",
                    side === "buy"
                      ? "bg-success/15 text-success"
                      : "bg-danger/15 text-danger",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                {side === "buy" ? "Buy" : "Sell"}{" "}
                <span className="text-brand">{ticker}</span>
              </Dialog.Title>
              <Dialog.Description className="text-sm text-fg-muted">
                {side === "buy"
                  ? "Add to your position. Cost basis updates with a weighted average."
                  : "Reduce your position. Cannot exceed current quantity."}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="rounded p-1 text-fg-muted hover:bg-overlay/5 hover:text-fg">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Current position block — shows both for buy (context) and sell (guard). */}
          <div className="mt-5 rounded-xl border border-border bg-bg-soft/60 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="label">Your position</div>
              <span className="num text-[11px] text-fg-muted">
                Market {formatCurrency(market)}
              </span>
            </div>
            {position ? (
              <div className="grid grid-cols-3 gap-3 text-sm">
                <Stat label="Quantity" value={availableQty.toLocaleString()} />
                <Stat label="Avg buy" value={formatCurrency(avg)} />
                <Stat
                  label="P&L"
                  value={formatCurrency(positionPnl)}
                  sub={formatPercent(positionPnlPct)}
                  tone={positionPnl >= 0 ? "pos" : "neg"}
                />
                <Stat label="Invested" value={formatCurrency(positionInvested)} />
                <Stat label="Value" value={formatCurrency(positionValue)} />
                {side === "sell" && (
                  <Stat
                    label="Available"
                    value={availableQty.toLocaleString()}
                    tone="brand"
                  />
                )}
              </div>
            ) : (
              <div className="text-sm text-fg-muted">
                {side === "buy"
                  ? "No existing position — this will open a new one."
                  : "You don't own any of this asset yet."}
              </div>
            )}
          </div>

          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="label">Quantity</label>
                  {side === "sell" && position && (
                    <button
                      type="button"
                      onClick={() => setQty(String(availableQty))}
                      className="text-[11px] font-medium text-brand hover:underline"
                    >
                      Max
                    </button>
                  )}
                </div>
                <input
                  className={cn("input num", inlineError && "border-danger focus:border-danger focus:ring-danger/30")}
                  type="number"
                  step="any"
                  min="0"
                  max={side === "sell" ? availableQty || undefined : undefined}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="label">Price</label>
                  {priceTouched.current && livePrice && (
                    <button
                      type="button"
                      onClick={() => {
                        priceTouched.current = false;
                        setPrice(livePrice.toFixed(2));
                      }}
                      className="text-[11px] font-medium text-brand hover:underline"
                    >
                      Use live
                    </button>
                  )}
                </div>
                <input
                  className="input num"
                  type="number"
                  step="any"
                  min="0"
                  value={price}
                  onChange={(e) => {
                    priceTouched.current = true;
                    setPrice(e.target.value);
                  }}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="label" htmlFor="trade-note">
                  Note <span className="text-fg-subtle">(optional)</span>
                </label>
                <span className="num text-[10px] text-fg-subtle">
                  {note.length}/200
                </span>
              </div>
              <input
                id="trade-note"
                className="input text-sm"
                type="text"
                maxLength={200}
                placeholder={
                  side === "buy"
                    ? "e.g. post-earnings dip, tactical add"
                    : "e.g. LTCG harvest, trim on rally"
                }
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <p className="text-[11px] text-fg-subtle">
                Stored with the transaction so you remember why you placed it.
              </p>
            </div>

            <div className="space-y-2 rounded-lg border border-border bg-bg-soft px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="label">Order value</div>
                <span className="num text-sm">{formatCurrency(total)}</span>
              </div>
              {charges.total > 0 && (
                <>
                  <div className="flex items-center justify-between text-[11px] text-fg-muted">
                    <span>Brokerage</span>
                    <span className="num">{formatCurrency(charges.brokerage)}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-fg-muted">
                    <span>Statutory + GST</span>
                    <span className="num">{formatCurrency(charges.statutory)}</span>
                  </div>
                </>
              )}
              {assetType === "mf" && parsedQty > 0 && (
                <div className="text-[11px] text-fg-subtle">
                  Direct plan — no brokerage or statutory charges.
                </div>
              )}
              <div className="flex items-center justify-between border-t border-border/60 pt-2">
                <div>
                  <div className="label">
                    {side === "buy" ? "Net debit" : "Net credit"}
                  </div>
                  {parsedQty > 0 && position && (
                    <div className="num mt-0.5 text-[11px] text-fg-muted">
                      {side === "buy"
                        ? `New qty: ${(availableQty + parsedQty).toLocaleString()}`
                        : `Remaining: ${(availableQty - parsedQty).toLocaleString()}`}
                    </div>
                  )}
                </div>
                <span className="num text-lg font-medium">{formatCurrency(net)}</span>
              </div>
              {side === "buy" && (
                <div className="flex items-center justify-between text-[11px]">
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
              )}
            </div>

            {inlineError && !err && (
              <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
                {inlineError}
              </div>
            )}
            {err && (
              <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                {err}
              </div>
            )}

            <button
              type="submit"
              disabled={mutation.isPending || !!inlineError || parsedQty <= 0}
              className={cn("w-full", side === "buy" ? "btn-primary" : "btn-danger")}
            >
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm {side === "buy" ? "buy" : "sell"}
            </button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
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
      {sub && (
        <div
          className={cn(
            "num text-[11px]",
            tone === "pos" && "pos",
            tone === "neg" && "neg",
            !tone && "text-fg-muted",
          )}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
