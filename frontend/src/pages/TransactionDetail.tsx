import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Check,
  ClipboardCopy,
  Copy,
  Loader2,
  ScrollText,
  ShieldCheck,
} from "lucide-react";
import { useTransactionDetail } from "@/hooks/usePortfolio";
import { assetHref, cn, formatCurrency, toNum } from "@/lib/utils";
import type { LedgerEntry } from "@/lib/types";
import { SourceChip } from "@/components/SourceChip";

export function TransactionDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useTransactionDetail(id);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center py-24 text-fg-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading transaction…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="mx-auto max-w-xl py-24 text-center">
        <p className="text-sm text-fg-muted">Transaction not found or access denied.</p>
        <button className="btn-outline mt-4 text-xs" onClick={() => navigate("/transactions")}>
          Back to transactions
        </button>
      </div>
    );
  }

  const { transaction: t, ledgerEntries, auditEntries } = data;
  const isBuy = t.side === "buy";
  const total = toNum(t.totalAmount);
  const fees = toNum(t.fees);
  const qty = toNum(t.quantity);
  const price = toNum(t.price);
  // Wallet-era columns. Pre-wallet rows have these as 0; we fall back to the
  // legacy gross + fees totals so old transactions still render meaningfully.
  const brokerage = toNum(t.brokerage);
  const statutory = toNum(t.statutory);
  const netAmount = toNum(t.netAmount);
  const hasCharges = brokerage > 0 || statutory > 0;
  const heroAmount = netAmount > 0 ? netAmount : total;
  const gross = qty * price;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <button
        type="button"
        onClick={() => navigate("/transactions")}
        className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" /> Back to transactions
      </button>

      {/* Hero */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="card overflow-hidden"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 p-6">
          <div className="flex items-start gap-4">
            <span
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-xl",
                isBuy ? "bg-success/15 text-success" : "bg-danger/15 text-danger",
              )}
            >
              {isBuy ? <ArrowDownLeft className="h-6 w-6" /> : <ArrowUpRight className="h-6 w-6" />}
            </span>
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-fg-muted">
                <span>{t.assetType}</span>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize",
                    isBuy
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-danger/30 bg-danger/10 text-danger",
                  )}
                >
                  {t.side}
                </span>
                <SourceChip source={t.source} />
              </div>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                {isBuy ? "Bought" : "Sold"}{" "}
                <span className="num">{qty.toLocaleString()}</span>{" "}
                <Link to={assetHref(t.ticker, t.assetType)} className="text-brand hover:underline">
                  {t.ticker}
                </Link>
              </h1>
              <p className="mt-1 text-sm text-fg-muted">
                at {formatCurrency(price)} on{" "}
                {new Date(t.executedAt).toLocaleString()}
              </p>
              {/* "via" line: human explanation of where this came from. */}
              <p className="mt-2 text-[12px] text-fg-muted">
                {sourceBlurb(t.source, t.sourceId, t.note)}
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className="label">{isBuy ? "Net debit" : "Net credit"}</div>
            <div className="num mt-1 text-3xl font-semibold">{formatCurrency(heroAmount)}</div>
            <div className="num text-xs text-fg-muted">
              gross {formatCurrency(gross)}
              {hasCharges && (
                <>
                  {" · "}
                  {isBuy ? "+" : "−"}charges {formatCurrency(brokerage + statutory)}
                </>
              )}
              {!hasCharges && fees > 0 && (
                <> · incl. fees {formatCurrency(fees)}</>
              )}
            </div>
          </div>
        </div>
      </motion.section>

      {/* Charges breakdown — like a real broker contract note. */}
      {(hasCharges || netAmount > 0) && (
        <section className="card p-6">
          <div className="flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-fg-muted" />
            <span className="label">Contract note</span>
          </div>
          <dl className="mt-4 space-y-2 text-sm">
            <ChargeRow label="Order value (qty × price)" value={formatCurrency(gross)} />
            <ChargeRow
              label="Brokerage"
              value={formatCurrency(brokerage)}
              tone={isBuy ? "neg" : "neg"}
              prefix={brokerage > 0 ? "−" : ""}
            />
            <ChargeRow
              label="Statutory + GST"
              value={formatCurrency(statutory)}
              tone="neg"
              prefix={statutory > 0 ? "−" : ""}
            />
            <div className="my-2 border-t border-border/60" />
            <ChargeRow
              label={isBuy ? "Net debit (wallet)" : "Net credit (wallet)"}
              value={formatCurrency(heroAmount)}
              bold
            />
          </dl>
          {!hasCharges && t.assetType === "mf" && (
            <p className="mt-3 text-[11px] text-fg-subtle">
              Direct mutual-fund plan — zero brokerage and statutory charges.
            </p>
          )}
        </section>
      )}

      {/* Field grid */}
      <section className="card p-6">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-fg-muted" />
          <span className="label">All fields</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-3">
          <Field label="Transaction ID" value={t.id} mono copy />
          <Field label="Side" value={t.side} />
          <Field label="Asset type" value={t.assetType} />
          <Field label="Ticker" value={t.ticker} mono />
          <Field label="Quantity" value={qty.toLocaleString("en-IN", { maximumFractionDigits: 8 })} />
          <Field label="Price" value={formatCurrency(price)} />
          <Field label="Order value" value={formatCurrency(gross)} />
          <Field label="Brokerage" value={formatCurrency(brokerage)} />
          <Field label="Statutory + GST" value={formatCurrency(statutory)} />
          <Field
            label={isBuy ? "Net debit" : "Net credit"}
            value={formatCurrency(heroAmount)}
          />
          {fees > 0 && <Field label="Legacy fees" value={formatCurrency(fees)} />}
          <Field label="Executed at" value={new Date(t.executedAt).toLocaleString()} />
          <Field label="User ID" value={t.userId} mono copy />
          <Field label="Portfolio ID" value={t.portfolioId} mono copy />
          <Field label="Note" value={t.note ?? "—"} />
          <Field label="Source" value={sourceLabel(t.source)} />
          {t.sourceId && (
            <Field label="Source ID" value={t.sourceId} mono copy />
          )}
        </div>
        {t.source === "sip" && t.sourceId && (
          <div className="mt-5 flex items-center justify-between rounded-lg border border-violet-500/30 bg-violet-500/5 px-4 py-3 text-sm">
            <div>
              <div className="font-medium text-violet-200">Executed by a SIP plan</div>
              <div className="num mt-0.5 text-xs text-fg-muted">
                plan <span className="font-mono">{t.sourceId.slice(0, 8)}</span>
              </div>
            </div>
            <Link to="/sips" className="btn-ghost h-8 px-3 text-xs">
              View SIPs →
            </Link>
          </div>
        )}
      </section>

      {/* Ledger */}
      <LedgerCard entries={ledgerEntries} />

      {/* Audit */}
      <section className="card p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-fg-muted" />
            <span className="label">Audit trail</span>
          </div>
          <span className="num text-xs text-fg-muted">{auditEntries.length} entries</span>
        </div>
        {auditEntries.length === 0 ? (
          <p className="text-sm text-fg-muted">
            No audit rows linked to this transaction.
          </p>
        ) : (
          <ol className="space-y-3">
            {auditEntries.map((a) => (
              <li
                key={a.id}
                className="rounded-lg border border-border/60 bg-bg-soft/60 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{a.action}</span>
                  <span className="num text-xs text-fg-muted">
                    #{a.id} · {new Date(a.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-fg-muted">
                  <span>
                    type: <span className="text-fg">{a.entityType}</span>
                  </span>
                  {a.ip && (
                    <span>
                      ip: <span className="text-fg">{a.ip}</span>
                    </span>
                  )}
                </div>
                <pre className="mt-2 max-h-48 overflow-auto rounded bg-bg px-3 py-2 text-[11px] text-fg-muted">
                  {JSON.stringify(a.payload, null, 2)}
                </pre>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-[11px] text-fg-subtle">
          This row is append-only. Postgres triggers reject any UPDATE or DELETE
          against the <code className="kbd">audit_log</code> table.
        </p>
      </section>
    </div>
  );
}

function ChargeRow({
  label,
  value,
  prefix,
  tone,
  bold,
}: {
  label: string;
  value: string;
  prefix?: string;
  tone?: "pos" | "neg";
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={cn("text-fg-muted", bold && "font-medium text-fg")}>{label}</span>
      <span
        className={cn(
          "num",
          bold && "text-base font-semibold",
          tone === "neg" && !bold && "text-fg-muted",
        )}
      >
        {prefix}
        {value}
      </span>
    </div>
  );
}

function sourceBlurb(
  source: string,
  sourceId: string | null | undefined,
  note: string | null | undefined,
): string {
  switch (source) {
    case "sip":
      return `Auto-executed by a SIP plan${sourceId ? ` (${sourceId.slice(0, 8)}…)` : ""}.`;
    case "alert":
      return "Executed because a price alert fired.";
    case "rebalance":
      return "Written by the auto-rebalancer.";
    case "manual":
    default:
      return note?.trim()
        ? `Manually placed from the app. Note: "${note}"`
        : "Manually placed from the app. No upstream source — you clicked Buy or Sell yourself.";
  }
}

function sourceLabel(source: string): string {
  switch (source) {
    case "sip":
      return "SIP";
    case "alert":
      return "Alert";
    case "rebalance":
      return "Rebalance";
    case "manual":
      return "Manual";
    default:
      return source;
  }
}

function LedgerCard({ entries }: { entries: LedgerEntry[] }) {
  const sums = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const e of entries) {
      const a = toNum(e.amount);
      if (e.direction === "debit") debit += a;
      else credit += a;
    }
    return { debit, credit, balanced: Math.abs(debit - credit) < 1e-6 };
  }, [entries]);

  return (
    <section className="card p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardCopy className="h-4 w-4 text-fg-muted" />
          <span className="label">Ledger entries</span>
        </div>
        <span
          className={cn(
            "chip num",
            sums.balanced ? "border-success/30 text-success" : "border-danger/30 text-danger",
          )}
          title="Double-entry bookkeeping requires the sum of debits to equal the sum of credits."
        >
          {sums.balanced && <CheckCircle2 className="h-3 w-3" />}
          {sums.balanced ? "balanced" : "imbalanced"}
        </span>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-fg-muted">No ledger rows linked to this transaction.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-fg-muted">
              <tr className="border-b border-border/60">
                <th className="px-3 py-2 text-left font-medium">Account</th>
                <th className="px-3 py-2 text-left font-medium">Direction</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-right font-medium">Currency</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-border/40 last:border-0">
                  <td className="px-3 py-2 font-medium">{e.account}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize",
                        e.direction === "debit"
                          ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
                          : "border-violet-500/30 bg-violet-500/10 text-violet-300",
                      )}
                    >
                      {e.direction}
                    </span>
                  </td>
                  <td className="num px-3 py-2 text-right">
                    {formatCurrency(toNum(e.amount))}
                  </td>
                  <td className="num px-3 py-2 text-right text-fg-muted">{e.currency}</td>
                </tr>
              ))}
              <tr className="border-t border-border/60 bg-bg-soft/40">
                <td className="px-3 py-2 font-medium text-fg-muted" colSpan={2}>
                  Totals
                </td>
                <td className="num px-3 py-2 text-right">
                  <div className="flex flex-col items-end gap-0.5">
                    <span>
                      <span className="text-fg-muted">D </span>
                      {formatCurrency(sums.debit)}
                    </span>
                    <span>
                      <span className="text-fg-muted">C </span>
                      {formatCurrency(sums.credit)}
                    </span>
                  </div>
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[11px] text-fg-subtle">
        Every transaction writes at least two rows here — a debit into one
        account and a matching credit out of another — so the books are always
        balanced. Fees add two more rows (debit to <code className="kbd">fees</code>,
        credit from <code className="kbd">cash</code>).
      </p>
    </section>
  );
}

function Field({
  label,
  value,
  mono,
  copy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copy?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  function doCopy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  }
  return (
    <div>
      <div className="label">{label}</div>
      <div
        className={cn(
          "mt-1 flex items-center gap-2 break-all text-sm",
          mono && "font-mono text-[12px]",
        )}
      >
        <span>{value}</span>
        {copy && (
          <button
            type="button"
            onClick={doCopy}
            aria-label={`Copy ${label}`}
            className="rounded p-1 text-fg-subtle hover:bg-overlay/5 hover:text-fg"
          >
            {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          </button>
        )}
      </div>
    </div>
  );
}
