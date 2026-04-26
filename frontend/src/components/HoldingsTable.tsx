import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowUp,
  ArrowUpRight,
  ChevronRight,
  ChevronsUpDown,
} from "lucide-react";
import type { Holding } from "@/lib/types";
import { cn, formatCurrency, formatPercent, toNum } from "@/lib/utils";

export interface HoldingRow extends Holding {
  /** current price may be overridden by a live WS update for a snappier UI. */
  livePrice?: number;
  livePriceFlash?: "up" | "down";
}

type SortKey = "ticker" | "quantity" | "avg" | "price" | "value" | "pnl";
type SortDir = "asc" | "desc";

/**
 * The dashboard's holdings table. Fixed column widths via <colgroup> so
 * columns never overflow a narrow viewport — the 9 columns always fit in the
 * card, and cells that don't fit fall back to horizontal scroll cleanly.
 */
export function HoldingsTable({
  rows,
  onTrade,
  onOpen,
}: {
  rows: HoldingRow[];
  onTrade?: (ticker: string, side: "buy" | "sell") => void;
  onOpen?: (ticker: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir(k === "ticker" ? "asc" : "desc");
    }
  }

  const sorted = useMemo(() => {
    const computed = rows.map((h) => {
      const live = h.livePrice ?? toNum(h.currentPrice);
      const qty = toNum(h.quantity);
      const avg = toNum(h.avgBuyPrice);
      const value = live * qty;
      const pnl = (live - avg) * qty;
      const pnlPct = avg > 0 ? ((live - avg) / avg) * 100 : 0;
      return { h, live, qty, avg, value, pnl, pnlPct };
    });
    const dir = sortDir === "asc" ? 1 : -1;
    computed.sort((a, b) => {
      switch (sortKey) {
        case "ticker":
          return a.h.ticker.localeCompare(b.h.ticker) * dir;
        case "quantity":
          return (a.qty - b.qty) * dir;
        case "avg":
          return (a.avg - b.avg) * dir;
        case "price":
          return (a.live - b.live) * dir;
        case "value":
          return (a.value - b.value) * dir;
        case "pnl":
          return (a.pnl - b.pnl) * dir;
      }
    });
    return computed;
  }, [rows, sortKey, sortDir]);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <div className="label">Holdings</div>
          <div className="text-xs text-fg-muted">{rows.length} positions · live</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[22%] min-w-[180px]" />
            <col className="w-[9%]  min-w-[70px]" />
            <col className="w-[12%] min-w-[100px]" />
            <col className="w-[13%] min-w-[110px]" />
            <col className="w-[13%] min-w-[120px]" />
            <col className="w-[13%] min-w-[120px]" />
            <col className="w-[18%] min-w-[150px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-border/80 text-[11px] uppercase tracking-wider text-fg-muted">
              <Th onClick={() => toggleSort("ticker")} active={sortKey === "ticker"} dir={sortDir}>
                Asset
              </Th>
              <Th
                onClick={() => toggleSort("quantity")}
                active={sortKey === "quantity"}
                dir={sortDir}
                align="right"
              >
                Qty
              </Th>
              <Th
                onClick={() => toggleSort("avg")}
                active={sortKey === "avg"}
                dir={sortDir}
                align="right"
              >
                Avg Buy
              </Th>
              <Th
                onClick={() => toggleSort("price")}
                active={sortKey === "price"}
                dir={sortDir}
                align="right"
              >
                Price
              </Th>
              <Th
                onClick={() => toggleSort("value")}
                active={sortKey === "value"}
                dir={sortDir}
                align="right"
              >
                Value
              </Th>
              <Th
                onClick={() => toggleSort("pnl")}
                active={sortKey === "pnl"}
                dir={sortDir}
                align="right"
              >
                P&L
              </Th>
              <th className="px-3 py-3 text-right font-medium">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ h, live, qty, avg, value, pnl, pnlPct }) => (
              <tr
                key={h.id}
                onClick={() => onOpen?.(h.ticker)}
                className="group cursor-pointer border-b border-border/40 align-middle transition-colors last:border-0 hover:bg-white/[0.03]"
              >
                {/* Asset */}
                <td className="px-3 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-semibold",
                        h.assetType === "mf"
                          ? "bg-violet-500/15 text-violet-300"
                          : "bg-cyan-500/15 text-cyan-300",
                      )}
                    >
                      {h.ticker.slice(0, 2)}
                    </span>
                    <div className="min-w-0 leading-tight">
                      <div className="truncate font-medium group-hover:text-brand">
                        {h.ticker}
                      </div>
                      <div className="text-[10px] uppercase text-fg-muted">
                        {h.assetType}
                      </div>
                    </div>
                  </div>
                </td>

                {/* Qty */}
                <td className="num px-3 py-3 text-right">
                  {qty.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                </td>

                {/* Avg */}
                <td className="num px-3 py-3 text-right text-fg-muted">
                  {formatCurrency(avg)}
                </td>

                {/* Price with flash */}
                <td className="px-3 py-3 text-right">
                  <div
                    className={cn(
                      "num relative inline-block rounded px-1 py-0.5",
                      h.livePriceFlash === "up" && "animate-pulse-up",
                      h.livePriceFlash === "down" && "animate-pulse-down",
                    )}
                  >
                    {formatCurrency(live)}
                  </div>
                </td>

                {/* Value */}
                <td className="num px-3 py-3 text-right font-medium">
                  {formatCurrency(value)}
                </td>

                {/* P&L with % on second line */}
                <td className="px-3 py-3 text-right">
                  <div className={cn("num", pnl >= 0 ? "pos" : "neg")}>
                    {formatCurrency(pnl)}
                  </div>
                  <div className={cn("num text-[11px]", pnl >= 0 ? "pos" : "neg")}>
                    {formatPercent(pnlPct)}
                  </div>
                </td>

                {/* Actions */}
                <td
                  className="px-3 py-3 text-right"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-end gap-0.5">
                    <button
                      type="button"
                      onClick={() => onTrade?.(h.ticker, "buy")}
                      aria-label="Buy"
                      title="Buy"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-white/5 hover:text-success"
                    >
                      <ArrowDownLeft className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onTrade?.(h.ticker, "sell")}
                      aria-label="Sell"
                      title="Sell"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-white/5 hover:text-danger"
                    >
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpen?.(h.ticker)}
                      aria-label="Open detail"
                      title="Open detail"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-white/5 hover:text-fg"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-fg-muted">
                  No holdings yet. Run the seed script or add one manually.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({
  children,
  align = "left",
  onClick,
  active,
  dir,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  onClick: () => void;
  active: boolean;
  dir: SortDir;
}) {
  return (
    <th
      onClick={onClick}
      className={cn(
        "cursor-pointer select-none px-3 py-3 font-medium transition-colors hover:text-fg",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1",
          align === "right" && "flex-row-reverse",
        )}
      >
        {children}
        {active ? (
          dir === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" />
        )}
      </span>
    </th>
  );
}
