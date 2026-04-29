import { Link } from "react-router-dom";
import { ChevronRight, Layers, Loader2 } from "lucide-react";
import { useMfCatalog, type MfFund } from "@/hooks/useMfCatalog";
import { cn, formatCurrency, toNum } from "@/lib/utils";

interface MfSimilarFundsProps {
  category: string;
  /** Ticker of the fund to exclude (the one we're already viewing). */
  excludeTicker: string;
}

/**
 * Surfaces other funds in the same category. The catalog endpoint already
 * sorts by name within a category, so we get a stable, deduplicated set.
 */
export function MfSimilarFunds({ category, excludeTicker }: MfSimilarFundsProps) {
  const catalog = useMfCatalog({ category, limit: 9 });

  const funds = catalog.funds.filter((f) => f.ticker !== excludeTicker).slice(0, 6);

  return (
    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="label flex items-center gap-2">
            <Layers className="h-3.5 w-3.5" />
            Similar funds
          </div>
          <div className="text-xs text-fg-muted">
            Other funds in the {category} category.
          </div>
        </div>
        <Link
          to={`/funds?category=${encodeURIComponent(category)}`}
          className="text-xs text-fg-muted hover:text-fg"
        >
          See all →
        </Link>
      </div>

      {catalog.isLoading ? (
        <div className="flex h-16 items-center justify-center text-sm text-fg-muted">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : funds.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No other funds available in this category yet.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {funds.map((f) => (
            <SimilarRow key={f.ticker} fund={f} />
          ))}
        </ul>
      )}
    </section>
  );
}

function SimilarRow({ fund }: { fund: MfFund }) {
  const nav = fund.nav ? toNum(fund.nav.value) : 0;
  const change = fund.nav?.changePct ? toNum(fund.nav.changePct) : null;
  return (
    <li>
      <Link
        to={`/funds/${fund.ticker}`}
        className="group block rounded-lg border border-border/60 bg-bg-soft/30 px-3 py-2.5 transition-colors hover:border-border-strong hover:bg-bg-soft/60"
      >
        <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
          {fund.amc}
        </div>
        <div className="flex items-baseline gap-3">
          <div className="min-w-0 flex-1 truncate text-sm font-medium leading-tight group-hover:text-brand">
            {fund.name}
          </div>
          <div className="flex shrink-0 items-baseline gap-2">
            <span className="num text-sm font-medium">
              {nav > 0 ? formatCurrency(nav) : "—"}
            </span>
            {change !== null && (
              <span
                className={cn(
                  "num text-[11px]",
                  change >= 0 ? "pos" : "neg",
                )}
              >
                {change >= 0 ? "+" : ""}
                {change.toFixed(2)}%
              </span>
            )}
            <ChevronRight className="h-3.5 w-3.5 self-center text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
        </div>
      </Link>
    </li>
  );
}
