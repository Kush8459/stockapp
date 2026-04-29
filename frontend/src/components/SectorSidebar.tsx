import { NavLink } from "react-router-dom";
import { Activity } from "lucide-react";
import { useSectors } from "@/hooks/useSectors";
import { useLivePrices } from "@/hooks/useLivePrices";
import { cn, toNum } from "@/lib/utils";

/**
 * Right rail listing every NSE sectoral index with live price + day change.
 * Click a row → /sector/:slug for the heatmap of components. Hidden below
 * the xl breakpoint (1280 px) — too narrow on tablets.
 */
export function SectorSidebar() {
  const { data: sectors = [] } = useSectors();
  const { quotes } = useLivePrices();

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-l border-border/80 bg-bg-soft/40 backdrop-blur xl:flex">
      <div className="flex items-center gap-2 px-4 pt-6 pb-3">
        <Activity className="h-3.5 w-3.5 text-brand" />
        <span className="label">Sectors</span>
      </div>
      <p className="px-4 pb-3 text-[10px] leading-snug text-fg-subtle">
        NSE sectoral indices, live. Click any row for a heatmap of its
        component stocks.
      </p>

      <nav className="flex-1 overflow-y-auto px-2 pb-6">
        {sectors.map((s) => {
          const live = quotes[s.indexTicker];
          const price = toNum(live?.price ?? s.quote?.price);
          const pct = toNum(live?.changePct ?? s.quote?.changePct);
          const has = price > 0;
          return (
            <NavLink
              key={s.slug}
              to={`/sector/${s.slug}`}
              className={({ isActive }) =>
                cn(
                  "group flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive ? "bg-overlay/[0.06] text-fg" : "text-fg-muted hover:bg-overlay/[0.03] hover:text-fg",
                )
              }
            >
              <span className="min-w-0 truncate">{s.name}</span>
              <span className="flex shrink-0 items-baseline gap-2 text-right">
                <span className="num text-[11px] text-fg-subtle">
                  {has ? price.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : "—"}
                </span>
                <span
                  className={cn(
                    "num text-[11px] font-medium tabular-nums",
                    !has ? "text-fg-subtle" : pct >= 0 ? "pos" : "neg",
                  )}
                >
                  {has ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : ""}
                </span>
              </span>
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
