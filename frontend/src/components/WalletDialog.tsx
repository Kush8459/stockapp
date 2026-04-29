import { FormEvent, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CreditCard,
  Loader2,
  Smartphone,
  Wallet2,
  X,
} from "lucide-react";
import { apiErrorMessage } from "@/lib/api";
import {
  useDeposit,
  useWallet,
  useWithdraw,
  type DepositMethod,
} from "@/hooks/useWallet";
import { useToast } from "./Toaster";
import { cn, formatCurrency, toNum } from "@/lib/utils";

interface WalletDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultMode?: "deposit" | "withdraw";
}

const presets = [500, 1000, 5000, 10000, 25000, 50000];

const methods: Array<{ id: DepositMethod; label: string; icon: React.ReactNode; note: string }> = [
  { id: "upi", label: "UPI", icon: <Smartphone className="h-4 w-4" />, note: "@oksbi · @ybl · @paytm" },
  { id: "bank", label: "Net banking", icon: <Banknote className="h-4 w-4" />, note: "IMPS / NEFT" },
  { id: "card", label: "Debit card", icon: <CreditCard className="h-4 w-4" />, note: "Visa / Mastercard / RuPay" },
];

export function WalletDialog({
  open,
  onOpenChange,
  defaultMode = "deposit",
}: WalletDialogProps) {
  const [mode, setMode] = useState<"deposit" | "withdraw">(defaultMode);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid max-h-[92vh] w-[94vw] max-w-md -translate-x-1/2 -translate-y-1/2 grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_1fr_auto] overflow-hidden rounded-2xl border border-border bg-bg-card shadow-glow">
          <Header onClose={() => onOpenChange(false)} />

          {/* Mode toggle */}
          <div className="border-b border-border/70 px-6 pt-4">
            <div className="flex items-center gap-1 rounded-lg border border-border bg-bg-soft p-0.5 w-fit">
              <ModeBtn
                active={mode === "deposit"}
                onClick={() => setMode("deposit")}
                icon={<ArrowDownLeft className="h-3.5 w-3.5" />}
                label="Deposit"
              />
              <ModeBtn
                active={mode === "withdraw"}
                onClick={() => setMode("withdraw")}
                icon={<ArrowUpRight className="h-3.5 w-3.5" />}
                label="Withdraw"
              />
            </div>
          </div>

          {mode === "deposit" ? (
            <DepositPanel onDone={() => onOpenChange(false)} />
          ) : (
            <WithdrawPanel onDone={() => onOpenChange(false)} />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  const wallet = useWallet();
  const balance = toNum(wallet.data?.balance);
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/70 px-6 py-5">
      <div>
        <Dialog.Title className="flex items-center gap-2 text-lg font-semibold">
          <Wallet2 className="h-5 w-5 text-brand" />
          Wallet
        </Dialog.Title>
        <Dialog.Description className="mt-1 text-xs text-fg-muted">
          Available balance{" "}
          <span className="num text-fg">{formatCurrency(balance)}</span> · paper
          trading
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

// ── Deposit ─────────────────────────────────────────────────────────────

function DepositPanel({ onDone }: { onDone: () => void }) {
  const deposit = useDeposit();
  const { push } = useToast();
  const [amount, setAmount] = useState("5000");
  const [method, setMethod] = useState<DepositMethod>("upi");
  const [err, setErr] = useState<string | null>(null);

  const amountNum = toNum(amount);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (amountNum < 100) {
      setErr("Minimum deposit is ₹100.");
      return;
    }
    if (amountNum > 1_000_000) {
      setErr("Single-deposit cap is ₹10,00,000 (paper-trading limit).");
      return;
    }
    try {
      const res = await deposit.mutateAsync({
        amount,
        method,
        reference: methodLabel(method),
      });
      push({
        kind: "success",
        title: `Deposited ${formatCurrency(amountNum)}`,
        description: `New balance ${formatCurrency(toNum(res.balanceAfter))}`,
      });
      onDone();
    } catch (e2) {
      setErr(apiErrorMessage(e2));
    }
  }

  return (
    <>
      <form
        id="wallet-deposit-form"
        noValidate
        onSubmit={onSubmit}
        className="space-y-5 overflow-y-auto px-6 py-5 scrollbar-none"
      >
        <AmountField amount={amount} setAmount={setAmount} />
        <MethodPicker value={method} onChange={setMethod} />
        {err && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {err}
          </div>
        )}
        <div className="rounded-lg border border-border/60 bg-bg-soft/40 p-3 text-[11px] text-fg-muted">
          Paper-trading mode — no real money moves. The amount is added
          instantly to your wallet and can be used to buy stocks or MFs.
        </div>
      </form>

      <div className="flex items-center justify-between gap-3 border-t border-border/70 bg-bg-card px-6 py-4">
        <div className="text-[11px] text-fg-muted">
          Via <span className="text-fg">{methodLabel(method)}</span>
        </div>
        <button
          type="submit"
          form="wallet-deposit-form"
          className="btn-primary min-w-40"
          disabled={deposit.isPending}
        >
          {deposit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Add {formatCurrency(amountNum)}
        </button>
      </div>
    </>
  );
}

// ── Withdraw ────────────────────────────────────────────────────────────

function WithdrawPanel({ onDone }: { onDone: () => void }) {
  const wallet = useWallet();
  const withdraw = useWithdraw();
  const { push } = useToast();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<DepositMethod>("bank");
  const [err, setErr] = useState<string | null>(null);

  const balance = toNum(wallet.data?.balance);
  const amountNum = toNum(amount);
  const overdraw = amountNum > balance;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (amountNum < 100) {
      setErr("Minimum withdrawal is ₹100.");
      return;
    }
    if (overdraw) {
      setErr(`You can withdraw up to ${formatCurrency(balance)} right now.`);
      return;
    }
    try {
      const res = await withdraw.mutateAsync({
        amount,
        method,
        reference: methodLabel(method),
      });
      push({
        kind: "success",
        title: `Withdrew ${formatCurrency(amountNum)}`,
        description: `New balance ${formatCurrency(toNum(res.balanceAfter))}`,
      });
      onDone();
    } catch (e2) {
      setErr(apiErrorMessage(e2));
    }
  }

  return (
    <>
      <form
        id="wallet-withdraw-form"
        noValidate
        onSubmit={onSubmit}
        className="space-y-5 overflow-y-auto px-6 py-5 scrollbar-none"
      >
        <div className="rounded-xl border border-border bg-bg-soft/60 p-4">
          <div className="text-[11px] uppercase tracking-wider text-fg-muted">
            Available
          </div>
          <div className="num mt-0.5 text-2xl font-semibold">
            {formatCurrency(balance)}
          </div>
        </div>

        <AmountField
          amount={amount}
          setAmount={(v) => setAmount(sanitizeAmount(v, balance))}
          max={balance}
        />
        <MethodPicker value={method} onChange={setMethod} />

        {err && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {err}
          </div>
        )}
      </form>

      <div className="flex items-center justify-between gap-3 border-t border-border/70 bg-bg-card px-6 py-4">
        <div className="text-[11px] text-fg-muted">
          To <span className="text-fg">{methodLabel(method)}</span>
        </div>
        <button
          type="submit"
          form="wallet-withdraw-form"
          className="btn-primary min-w-40"
          disabled={withdraw.isPending || amountNum <= 0 || overdraw}
        >
          {withdraw.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Withdraw {amountNum > 0 ? formatCurrency(amountNum) : ""}
        </button>
      </div>
    </>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────

function AmountField({
  amount,
  setAmount,
  max,
}: {
  amount: string;
  setAmount: (v: string) => void;
  max?: number;
}) {
  const amountNum = toNum(amount);
  return (
    <div className="space-y-2">
      <label className="label">Amount</label>
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
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {presets
          .filter((p) => max === undefined || p <= max)
          .map((p) => (
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
        {max !== undefined && max > 0 && (
          <button
            type="button"
            onClick={() => setAmount(String(Math.floor(max)))}
            className="num rounded-full border border-border px-2.5 py-1 text-xs text-fg-muted hover:border-border-strong hover:text-fg"
          >
            All
          </button>
        )}
      </div>
    </div>
  );
}

function MethodPicker({
  value,
  onChange,
}: {
  value: DepositMethod;
  onChange: (v: DepositMethod) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="label">Method</label>
      <div className="grid grid-cols-3 gap-2">
        {methods.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange(m.id)}
            className={cn(
              "rounded-lg border p-2.5 text-left transition-colors",
              value === m.id
                ? "border-brand bg-brand/10"
                : "border-border bg-bg-soft hover:border-border-strong",
            )}
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              {m.icon}
              {m.label}
            </div>
            <div className="mt-1 text-[10px] text-fg-subtle">{m.note}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function methodLabel(m: DepositMethod): string {
  return m === "upi" ? "UPI" : m === "bank" ? "Bank transfer" : "Debit card";
}

function sanitizeAmount(raw: string, max: number): string {
  if (raw === "") return "";
  const stripped = raw.replace(/^0+(?=\d)/, "");
  const parsed = parseFloat(stripped);
  if (!Number.isFinite(parsed) || parsed < 0) return "";
  if (max > 0 && parsed > max) {
    return String(Math.floor(max * 100) / 100);
  }
  return stripped;
}
