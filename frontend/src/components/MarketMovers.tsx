import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Filter, TrendingDown, TrendingUp } from "lucide-react";
import {
  useAvailableIndices,
  useMarketMovers,
} from "@/hooks/useMarketMovers";
import { useLivePrices, type Quote } from "@/hooks/useLivePrices";
import { cn, formatCurrency, formatPercent, toNum } from "@/lib/utils";

/**
 * Top market gainers and losers for the day, across NSE. The filter
 * dropdown narrows the ranking pool to a specific index — e.g. "movers
 * within NIFTY 50". REST values seed the rows; WS ticks override visible
 * cells via useLivePrices.
 */
export function MarketMovers() {
  const [indexSlug, setIndexSlug] = useState<string>("");
  const { data, isLoading } = useMarketMovers({ index: indexSlug, limit: 5 });
  const { data: availableIndices = [] } = useAvailableIndices();

  return (
    <section className="card p-5">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label">Market Movers Today</div>
          <p className="mt-1 text-xs text-fg-muted">
            Biggest day-change % across NSE
            {data?.total ? ` · pool of ${data.total}` : ""}.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-fg-muted">
          <Filter className="h-3.5 w-3.5" />
          <select
            value={indexSlug}
            onChange={(e) => setIndexSlug(e.target.value)}
            className="input !py-1.5 !pl-2 !pr-7 text-xs"
          >
            <option value="">All NSE</option>
            {availableIndices.map((idx) => (
              <option key={idx.slug} value={idx.slug}>
                {idx.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {isLoading ? (
        <div className="py-6 text-center text-sm text-fg-muted">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Column
            title="Top Gainers"
            icon={<TrendingUp className="h-3.5 w-3.5" />}
            tone="pos"
            items={data?.gainers ?? []}
          />
          <Column
            title="Top Losers"
            icon={<TrendingDown className="h-3.5 w-3.5" />}
            tone="neg"
            items={data?.losers ?? []}
          />
        </div>
      )}
    </section>
  );
}

function Column({
  title,
  icon,
  tone,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  tone: "pos" | "neg";
  items: Quote[];
}) {
  return (
    <div>
      <div
        className={cn(
          "mb-2 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
          tone === "pos"
            ? "border-success/30 bg-success/10 text-success"
            : "border-danger/30 bg-danger/10 text-danger",
        )}
      >
        {icon}
        {title}
      </div>
      {items.length === 0 ? (
        <div className="rounded-lg border border-border/40 bg-bg-soft/40 px-3 py-6 text-center text-xs text-fg-muted">
          {tone === "pos" ? "No gainers right now." : "No losers right now."}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {items.map((q, i) => (
            <Row key={q.ticker} q={q} index={i} tone={tone} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ q, index, tone }: { q: Quote; index: number; tone: "pos" | "neg" }) {
  const { quotes } = useLivePrices();
  const live = quotes[q.ticker];
  const price = toNum(live?.price ?? q.price);
  const pct = toNum(live?.changePct ?? q.changePct);
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
    >
      <Link
        to={`/stock/${q.ticker}`}
        className="flex items-center justify-between rounded-lg border border-border/60 bg-bg-soft/50 px-3 py-2 transition-colors hover:border-brand/40 hover:bg-bg-soft"
      >
        <span className="font-medium">{q.ticker}</span>
        <div className="flex items-center gap-3 text-sm">
          <span className="num text-fg-muted">{formatCurrency(price)}</span>
          <span className={cn("num font-semibold", tone === "pos" ? "pos" : "neg")}>
            {formatPercent(pct)}
          </span>
        </div>
      </Link>
    </motion.li>
  );
}
