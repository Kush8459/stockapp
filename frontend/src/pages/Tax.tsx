import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Calculator,
  Download,
  FileSpreadsheet,
  Info,
  Loader2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  useTaxReport,
  type Category,
  type Realization,
  type TaxReport,
  type YearSummary,
} from "@/hooks/useTax";
import { cn, formatCompact, formatCurrency, toNum } from "@/lib/utils";
import { downloadCsv, toCsv } from "@/lib/csv";

export function TaxPage() {
  const { data, isLoading } = useTaxReport();
  const [activeFY, setActiveFY] = useState<string | null>(null);

  // Default to the most recent FY once data loads.
  const current: YearSummary | null = useMemo(() => {
    if (!data || data.years.length === 0) return null;
    if (activeFY) {
      return data.years.find((y) => y.financialYear === activeFY) ?? data.years[0];
    }
    return data.years[0];
  }, [data, activeFY]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center py-24 text-fg-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading tax report…
      </div>
    );
  }

  if (!data || data.years.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <Header />
        <UnrealizedCard data={data} />
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Header />

      <FYSelector
        years={data.years}
        active={current?.financialYear ?? data.years[0].financialYear}
        onChange={setActiveFY}
      />

      {current && <YearCards y={current} rates={data.rates} />}
      {current && current.realizations.length > 0 && (
        <RealizationsTable fy={current.financialYear} items={current.realizations} />
      )}

      <UnrealizedCard data={data} />

      <Footer data={data} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header() {
  return (
    <header>
      <div className="text-xs uppercase tracking-wider text-fg-muted">Reports</div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Tax P&amp;L</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Realized gains classified into STCG / LTCG using FIFO lot matching.
        Rates reflect Indian tax rules effective from 23 Jul 2024.
      </p>
    </header>
  );
}

// ---------------------------------------------------------------------------
// FY selector
// ---------------------------------------------------------------------------

function FYSelector({
  years,
  active,
  onChange,
}: {
  years: YearSummary[];
  active: string;
  onChange: (fy: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-bg-soft p-1">
      {years.map((y) => {
        const isActive = y.financialYear === active;
        const total = toNum(y.totalTax);
        return (
          <button
            key={y.financialYear}
            type="button"
            onClick={() => onChange(y.financialYear)}
            className={cn(
              "group flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              isActive ? "bg-overlay/10 text-fg" : "text-fg-muted hover:text-fg",
            )}
          >
            <span>{y.financialYear}</span>
            <span
              className={cn(
                "num rounded-full px-1.5 text-[10px]",
                total > 0 ? "bg-warn/15 text-warn" : "bg-overlay/5",
              )}
            >
              {total > 0 ? `Tax ${formatCompact(total)}` : "No tax"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Year cards — the three tax buckets + totals
// ---------------------------------------------------------------------------

function YearCards({
  y,
  rates,
}: {
  y: YearSummary;
  rates: TaxReport["rates"];
}) {
  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <BucketCard
          title="Short-term equity"
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          rate={`${rates.stcgEquityPct}%`}
          gain={y.stcgEquityGain}
          tax={y.stcgEquityTax}
          note="Equity / MF held < 12 months"
          tone="cyan"
        />
        <BucketCard
          title="Long-term equity"
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          rate={`${rates.ltcgEquityPct}% above ${formatCompact(toNum(rates.ltcgExemption))}`}
          gain={y.ltcgEquityGain}
          tax={y.ltcgEquityTax}
          note={
            toNum(y.ltcgExemptionUsed) > 0
              ? `Exempted ${formatCurrency(toNum(y.ltcgExemptionUsed))}, taxable ${formatCurrency(toNum(y.ltcgTaxableGain))}`
              : "Equity / MF held ≥ 12 months"
          }
          tone="emerald"
        />
      </div>

      <TotalsCard y={y} />
    </section>
  );
}

function BucketCard({
  title,
  icon,
  rate,
  gain,
  tax,
  note,
  tone,
}: {
  title: string;
  icon: React.ReactNode;
  rate: string;
  gain: string;
  tax: string;
  note: string;
  tone: "cyan" | "emerald";
}) {
  const gainN = toNum(gain);
  const taxN = toNum(tax);
  const toneCls = {
    cyan: "border-cyan-500/30 text-cyan-300 bg-cyan-500/[0.06]",
    emerald: "border-emerald-500/30 text-emerald-300 bg-emerald-500/[0.06]",
  }[tone];

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="card flex flex-col p-4"
    >
      <div className={cn("inline-flex items-center gap-1.5 self-start rounded-full border px-2 py-0.5 text-[11px] font-medium", toneCls)}>
        {icon}
        {title}
      </div>
      <div className="num mt-3 text-[11px] text-fg-muted">Rate · {rate}</div>

      <div className="mt-3">
        <div className="label">Realized gain</div>
        <div
          className={cn(
            "num mt-0.5 text-xl font-semibold",
            gainN >= 0 ? "pos" : "neg",
          )}
        >
          {formatCurrency(gainN)}
        </div>
      </div>

      <div className="mt-3">
        <div className="label">Tax owed</div>
        <div
          className={cn(
            "num mt-0.5 text-xl font-semibold",
            taxN > 0 ? "text-warn" : "text-fg-muted",
          )}
        >
          {formatCurrency(taxN)}
        </div>
      </div>

      <p className="mt-3 text-[11px] text-fg-subtle">{note}</p>
    </motion.div>
  );
}

function TotalsCard({ y }: { y: YearSummary }) {
  const totalGain = toNum(y.totalGain);
  const totalTax = toNum(y.totalTax);
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="card flex flex-col gap-3 bg-gradient-to-br from-brand/[0.08] to-violet-500/[0.05] p-5"
    >
      <div className="flex items-center gap-1.5">
        <Calculator className="h-4 w-4 text-brand" />
        <span className="label">{y.financialYear} total</span>
      </div>
      <div>
        <div className="label">Realized gain</div>
        <div className={cn("num mt-0.5 text-2xl font-semibold", totalGain >= 0 ? "pos" : "neg")}>
          {formatCurrency(totalGain)}
        </div>
      </div>
      <div>
        <div className="label">Estimated tax</div>
        <div className={cn("num mt-0.5 text-2xl font-semibold", totalTax > 0 ? "text-warn" : "text-fg-muted")}>
          {formatCurrency(totalTax)}
        </div>
      </div>
      <div>
        <div className="label">Effective rate</div>
        <div className="num mt-0.5 text-lg font-medium">
          {toNum(y.effectiveRate).toFixed(2)}%
        </div>
      </div>
      <p className="text-[10px] leading-snug text-fg-subtle">
        Estimate only. Cess, surcharges, and set-off / carry-forward rules
        aren't applied. Consult a CA for filing.
      </p>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Realizations table
// ---------------------------------------------------------------------------

function RealizationsTable({ fy, items }: { fy: string; items: Realization[] }) {
  function exportCsv() {
    const header = [
      "Sell date",
      "Ticker",
      "Asset",
      "Qty",
      "Buy date",
      "Buy price",
      "Sell price",
      "Holding days",
      "Term",
      "Category",
      "Cost basis",
      "Proceeds",
      "Gain",
    ];
    const rows = items.map((r) => [
      r.sellDate,
      r.ticker,
      r.assetType,
      r.quantity,
      r.buyDate,
      r.buyPrice,
      r.sellPrice,
      String(r.holdingDays),
      r.term,
      r.category,
      r.costBasis,
      r.proceeds,
      r.gain,
    ]);
    downloadCsv(`tax-${fy}.csv`, toCsv([header, ...rows]));
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <div className="label">Realizations</div>
          <div className="text-xs text-fg-muted">
            {items.length} sell{items.length === 1 ? "" : "s"} in {fy} · FIFO-matched
          </div>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={items.length === 0}
          className="btn-outline h-8 px-3 text-xs"
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[14%] min-w-[120px]" />
            <col className="w-[14%] min-w-[110px]" />
            <col className="w-[9%]  min-w-[70px]" />
            <col className="w-[12%] min-w-[110px]" />
            <col className="w-[12%] min-w-[110px]" />
            <col className="w-[10%] min-w-[90px]" />
            <col className="w-[14%] min-w-[130px]" />
            <col className="w-[15%] min-w-[130px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-border/80 text-[11px] uppercase tracking-wider text-fg-muted">
              <th className="px-3 py-3 text-left font-medium">Sell date</th>
              <th className="px-3 py-3 text-left font-medium">Ticker</th>
              <th className="px-3 py-3 text-right font-medium">Qty</th>
              <th className="px-3 py-3 text-right font-medium">Buy → Sell</th>
              <th className="px-3 py-3 text-left font-medium">Holding</th>
              <th className="px-3 py-3 text-left font-medium">Term</th>
              <th className="px-3 py-3 text-right font-medium">Gain</th>
              <th className="px-3 py-3 text-left font-medium">Category</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r, i) => (
              <Row key={i} r={r} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Row({ r }: { r: Realization }) {
  const gain = toNum(r.gain);
  const termTone =
    r.term === "long"
      ? "border-success/30 bg-success/10 text-success"
      : "border-warn/30 bg-warn/10 text-warn";
  return (
    <tr className="border-b border-border/40 align-middle last:border-0">
      <td className="px-3 py-3 text-fg-muted">{formatDate(r.sellDate)}</td>
      <td className="px-3 py-3">
        <div className="font-medium">{r.ticker}</div>
        <div className="text-[10px] uppercase text-fg-muted">{r.assetType}</div>
      </td>
      <td className="num px-3 py-3 text-right">
        {toNum(r.quantity).toLocaleString(undefined, { maximumFractionDigits: 8 })}
      </td>
      <td className="px-3 py-3 text-right">
        <div className="num text-fg-muted">{formatCurrency(toNum(r.buyPrice))}</div>
        <div className="num text-[11px] text-fg">{formatCurrency(toNum(r.sellPrice))}</div>
      </td>
      <td className="px-3 py-3">
        <div className="num">{r.holdingDays}d</div>
        <div className="num text-[11px] text-fg-muted">
          {formatDate(r.buyDate)} → {formatDate(r.sellDate)}
        </div>
      </td>
      <td className="px-3 py-3">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize",
            termTone,
          )}
        >
          {r.term === "long" ? (
            <TrendingUp className="h-2.5 w-2.5" />
          ) : (
            <TrendingDown className="h-2.5 w-2.5" />
          )}
          {r.term}
        </span>
      </td>
      <td className={cn("num px-3 py-3 text-right font-medium", gain >= 0 ? "pos" : "neg")}>
        {formatCurrency(gain)}
      </td>
      <td className="px-3 py-3">
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px] font-medium",
            categoryTone(r.category),
          )}
        >
          {categoryLabel(r.category)}
        </span>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Unrealized card (forward-looking)
// ---------------------------------------------------------------------------

function UnrealizedCard({ data }: { data?: TaxReport }) {
  if (!data) return null;
  const u = data.unrealized;
  const total = toNum(u.totalGain);
  const stcg = toNum(u.stcgEquityGain);
  const ltcg = toNum(u.ltcgEquityGain);

  if (total === 0 && stcg === 0 && ltcg === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="card p-5"
    >
      <div className="flex items-center gap-1.5">
        <FileSpreadsheet className="h-4 w-4 text-brand" />
        <span className="label">If you sold everything today</span>
      </div>
      <p className="mt-1 text-xs text-fg-muted">
        Informational — based on current live prices. Not recorded; moves with the market.
      </p>
      <div className="mt-4 grid grid-cols-3 gap-4">
        <UnrealizedItem label="STCG equity" value={stcg} />
        <UnrealizedItem label="LTCG equity" value={ltcg} />
        <UnrealizedItem label="Total unrealized" value={total} bold />
      </div>
    </motion.section>
  );
}

function UnrealizedItem({
  label,
  value,
  bold,
}: {
  label: string;
  value: number;
  bold?: boolean;
}) {
  return (
    <div>
      <div className="label">{label}</div>
      <div
        className={cn(
          "num mt-0.5 text-lg",
          bold && "font-semibold",
          value > 0 ? "pos" : value < 0 ? "neg" : "text-fg-muted",
        )}
      >
        {formatCurrency(value)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty + footer
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="card flex flex-col items-center justify-center gap-3 p-14 text-center">
      <Info className="h-6 w-6 text-fg-subtle" />
      <p className="text-sm text-fg-muted">
        No realized gains yet. Once you sell a holding, the gain appears here
        — grouped by financial year and classified as STCG / LTCG.
      </p>
    </div>
  );
}

function Footer({ data }: { data: TaxReport }) {
  return (
    <div className="rounded-lg border border-border/60 bg-bg-soft/40 px-4 py-3 text-[11px] text-fg-subtle">
      Generated {new Date(data.generatedAt).toLocaleString()} · FIFO lot
      matching. Does not include cess, surcharge, or loss set-off. For
      information only; file your actual return with a qualified professional.
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function categoryTone(c: Category): string {
  switch (c) {
    case "stcg_equity":
      return "border-cyan-500/30 bg-cyan-500/10 text-cyan-300";
    case "ltcg_equity":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  }
}

function categoryLabel(c: Category): string {
  switch (c) {
    case "stcg_equity":
      return "STCG equity";
    case "ltcg_equity":
      return "LTCG equity";
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

