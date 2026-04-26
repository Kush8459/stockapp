import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  Download,
  Filter,
  Loader2,
} from "lucide-react";
import { useTransactions } from "@/hooks/usePortfolio";
import type { Transaction, TxnSource } from "@/lib/types";
import { cn, formatCurrency, toNum } from "@/lib/utils";
import { downloadCsv, toCsv } from "@/lib/csv";
import { SourceChip } from "@/components/SourceChip";

type SideFilter = "all" | "buy" | "sell";
type SourceFilter = "all" | TxnSource;

export function TransactionsPage() {
  const { data, isLoading } = useTransactions();
  const navigate = useNavigate();
  const [sideFilter, setSideFilter] = useState<SideFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const list = data ?? [];
    return list.filter((t) => {
      if (sideFilter !== "all" && t.side !== sideFilter) return false;
      if (sourceFilter !== "all" && t.source !== sourceFilter) return false;
      if (search && !t.ticker.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [data, sideFilter, sourceFilter, search]);

  const sourceCounts = useMemo(() => {
    const counts: Record<SourceFilter, number> = {
      all: data?.length ?? 0,
      manual: 0,
      sip: 0,
      alert: 0,
      rebalance: 0,
    };
    for (const t of data ?? []) counts[t.source] = (counts[t.source] ?? 0) + 1;
    return counts;
  }, [data]);

  const totalInvested = useMemo(
    () => rows.filter((r) => r.side === "buy").reduce((s, r) => s + toNum(r.totalAmount), 0),
    [rows],
  );
  const totalRealized = useMemo(
    () => rows.filter((r) => r.side === "sell").reduce((s, r) => s + toNum(r.totalAmount), 0),
    [rows],
  );

  function exportCsv() {
    if (!rows.length) return;
    const header = ["Date", "Side", "Source", "Ticker", "Asset", "Qty", "Price", "Total", "Fees", "Note", "ID"];
    const body = rows.map((t) => [
      new Date(t.executedAt).toISOString(),
      t.side,
      t.source,
      t.ticker,
      t.assetType,
      t.quantity,
      t.price,
      t.totalAmount,
      t.fees,
      t.note ?? "",
      t.id,
    ]);
    downloadCsv(
      `transactions-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv([header, ...body]),
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-fg-muted">History</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Transactions</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Immutable record of every buy and sell.
          </p>
        </div>
        <button className="btn-outline" onClick={exportCsv} disabled={rows.length === 0}>
          <Download className="h-4 w-4" /> Export CSV
        </button>
      </header>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Metric label="Transactions" value={rows.length.toLocaleString()} />
        <Metric label="Total invested" value={formatCurrency(totalInvested)} />
        <Metric label="Total realized" value={formatCurrency(totalRealized)} />
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
          <div className="relative">
            <input
              className="input !py-2 !pl-8 !pr-3 w-48 text-sm"
              placeholder="Filter ticker…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Filter className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-bg-soft p-0.5">
            {(["all", "buy", "sell"] as SideFilter[]).map((s) => (
              <button
                key={s}
                onClick={() => setSideFilter(s)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                  sideFilter === s
                    ? "rounded-md bg-white/10 text-fg"
                    : "text-fg-muted hover:text-fg",
                )}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-border bg-bg-soft p-0.5">
            {(["all", "manual", "sip", "alert"] as SourceFilter[]).map((s) => (
              <button
                key={s}
                onClick={() => setSourceFilter(s)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                  sourceFilter === s
                    ? "rounded-md bg-white/10 text-fg"
                    : "text-fg-muted hover:text-fg",
                )}
              >
                {s}
                <span className="num rounded-full bg-white/5 px-1.5 text-[10px]">
                  {sourceCounts[s] ?? 0}
                </span>
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-14 text-fg-muted">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="py-14 text-center text-sm text-fg-muted">
            No transactions match your filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-fg-muted">
                <tr className="border-b border-border/80">
                  <th className="px-4 py-3 text-left font-medium">When</th>
                  <th className="px-4 py-3 text-left font-medium">Side</th>
                  <th className="px-4 py-3 text-left font-medium">Asset</th>
                  <th className="px-4 py-3 text-left font-medium">Source</th>
                  <th className="px-4 py-3 text-right font-medium">Qty</th>
                  <th className="px-4 py-3 text-right font-medium">Price</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 text-right font-medium">Fees</th>
                  <th className="px-4 py-3 text-left font-medium">Note</th>
                  <th className="px-4 py-3 text-right font-medium">ID</th>
                  <th className="w-6 px-2 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((t, i) => (
                  <Row
                    key={t.id}
                    txn={t}
                    index={i}
                    onOpen={() => navigate(`/transactions/${t.id}`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Row({
  txn,
  index,
  onOpen,
}: {
  txn: Transaction;
  index: number;
  onOpen: () => void;
}) {
  const isBuy = txn.side === "buy";
  const shortId = txn.id.slice(0, 8);
  const when = new Date(txn.executedAt);
  return (
    <motion.tr
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: Math.min(index, 20) * 0.01 }}
      onClick={onOpen}
      className="group cursor-pointer border-b border-border/40 transition-colors last:border-0 hover:bg-white/[0.04]"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <td className="px-4 py-3">
        <div className="text-fg">{when.toLocaleDateString()}</div>
        <div className="num text-[11px] text-fg-muted">
          {when.toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </div>
      </td>
      <td className="px-4 py-3">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
            isBuy
              ? "border-success/30 bg-success/10 text-success"
              : "border-danger/30 bg-danger/10 text-danger",
          )}
        >
          {isBuy ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
          {txn.side}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md text-[10px] font-semibold",
              txn.assetType === "mf"
                ? "bg-violet-500/15 text-violet-300"
                : "bg-cyan-500/15 text-cyan-300",
            )}
          >
            {txn.ticker.slice(0, 2)}
          </span>
          <div className="leading-tight">
            <div className="font-medium">{txn.ticker}</div>
            <div className="text-[10px] uppercase text-fg-muted">{txn.assetType}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <SourceChip source={txn.source} />
      </td>
      <td className="num px-4 py-3 text-right">
        {toNum(txn.quantity).toLocaleString("en-IN", { maximumFractionDigits: 8 })}
      </td>
      <td className="num px-4 py-3 text-right text-fg-muted">
        {formatCurrency(toNum(txn.price))}
      </td>
      <td className="num px-4 py-3 text-right font-medium">
        {formatCurrency(toNum(txn.totalAmount))}
      </td>
      <td className="num px-4 py-3 text-right text-fg-muted">
        {formatCurrency(toNum(txn.fees))}
      </td>
      <td className="max-w-[14ch] truncate px-4 py-3 text-xs text-fg-muted">
        {txn.note ?? "—"}
      </td>
      <td className="num px-4 py-3 text-right font-mono text-[11px] text-fg-subtle">
        {shortId}
      </td>
      <td className="px-2 py-3 text-right">
        <ChevronRight className="h-4 w-4 text-fg-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
      </td>
    </motion.tr>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className="num mt-2 text-xl font-semibold">{value}</div>
    </div>
  );
}

