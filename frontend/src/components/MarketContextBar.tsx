import { Link } from "react-router-dom";
import { useLivePrices } from "@/hooks/useLivePrices";
import { cn, toNum } from "@/lib/utils";

// Five evenly-distributed broad indices that fill the row width without
// needing to scroll. NIFTY MIDCAP 100 added to balance broad-market
// (NIFTY 50 / SENSEX) with sectoral (BANK NIFTY / NIFTY IT) and a midcap
// gauge for retail.
const INDICES: Array<{ ticker: string; label: string }> = [
  { ticker: "NIFTY50", label: "NIFTY 50" },
  { ticker: "SENSEX", label: "SENSEX" },
  { ticker: "BANKNIFTY", label: "BANK NIFTY" },
  { ticker: "NIFTYIT", label: "NIFTY IT" },
  { ticker: "NIFTYMIDCAP", label: "NIFTY MIDCAP" },
];

export function MarketContextBar() {
  const { quotes } = useLivePrices();

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
      {INDICES.map((idx) => (
        <IndexPill
          key={idx.ticker}
          ticker={idx.ticker}
          label={idx.label}
          q={quotes[idx.ticker]}
        />
      ))}
    </div>
  );
}

function IndexPill({
  ticker,
  label,
  q,
}: {
  ticker: string;
  label: string;
  q?: { price: string; changePct: string };
}) {
  const price = toNum(q?.price);
  const pct = toNum(q?.changePct);
  const has = price > 0;
  return (
    <Link
      to={`/stock/${ticker}`}
      title={`${ticker} — view chart`}
      className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-bg-soft/50 px-3 py-1.5 text-sm transition-colors hover:border-brand/50 hover:bg-bg-soft"
    >
      <span className="text-[10px] font-medium uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      <div className="flex items-baseline gap-2">
        <span className="num text-xs font-medium">
          {has ? price.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
        </span>
        <span
          className={cn(
            "num text-[11px]",
            !has ? "text-fg-subtle" : pct >= 0 ? "pos" : "neg",
          )}
        >
          {has ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : ""}
        </span>
      </div>
    </Link>
  );
}
