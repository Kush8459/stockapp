import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  ChevronRight,
  ExternalLink,
  Filter,
  Loader2,
  Search,
} from "lucide-react";
import { useHoldings, usePortfolios } from "@/hooks/usePortfolio";
import { useHoldingsXirr } from "@/hooks/useHoldingsXirr";
import { useLivePrices } from "@/hooks/useLivePrices";
import { AlertForm } from "@/components/AlertForm";
import { TradeDialog } from "@/components/TradeDialog";
import { HoldingsHero } from "@/components/HoldingsHero";
import { LiveBadge } from "@/components/LiveBadge";
import { assetHref, cn, formatCurrency, formatPercent, toNum } from "@/lib/utils";
import type { Holding } from "@/lib/types";

type TypeFilter = "all" | "stock" | "mf";
type SortKey = "value-desc" | "pnl-desc" | "pnl-asc" | "ticker";

const palette = [
  "#06b6d4",
  "#8b5cf6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#3b82f6",
  "#ec4899",
  "#84cc16",
  "#22d3ee",
  "#a855f7",
];

export function HoldingsPage() {
  const navigate = useNavigate();
  const portfolios = usePortfolios();
  const portfolio = portfolios.data?.[0];
  const holdings = useHoldings(portfolio?.id);
  const { quotes, connected } = useLivePrices();

  const tickers = useMemo(
    () => (holdings.data ?? []).map((h) => h.ticker),
    [holdings.data],
  );
  const xirr = useHoldingsXirr(portfolio?.id, tickers);

  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("value-desc");
  const [trade, setTrade] = useState<
    | null
    | { ticker: string; side: "buy" | "sell"; assetType: Holding["assetType"] }
  >(null);
  const [alertFor, setAlertFor] = useState<string | null>(null);

  const enriched: EnrichedRow[] = useMemo(() => {
    return (holdings.data ?? []).map((h) => {
      const live = quotes[h.ticker] ? toNum(quotes[h.ticker].price) : toNum(h.currentPrice);
      const qty = toNum(h.quantity);
      const avg = toNum(h.avgBuyPrice);
      const invested = qty * avg;
      const value = qty * live;
      const pnl = value - invested;
      const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
      const dayChange = quotes[h.ticker]
        ? toNum(quotes[h.ticker].changePct)
        : toNum(h.dayChangePct);
      return {
        id: h.id,
        ticker: h.ticker,
        assetType: h.assetType,
        live,
        qty,
        avg,
        invested,
        value,
        pnl,
        pnlPct,
        dayChange,
      };
    });
  }, [holdings.data, quotes]);

  // Top + bottom performer across the portfolio (by P&L %). Used in the
  // second row of the totals card so a quick scan tells you what's pulling
  // the portfolio up vs dragging it down.
  const topMover = useMemo(() => {
    let best: typeof enriched[number] | null = null;
    let worst: typeof enriched[number] | null = null;
    for (const r of enriched) {
      if (r.invested <= 0) continue;
      if (!best || r.pnlPct > best.pnlPct) best = r;
      if (!worst || r.pnlPct < worst.pnlPct) worst = r;
    }
    return { best, worst };
  }, [enriched]);

  const totals = useMemo(() => {
    let invested = 0;
    let value = 0;
    let dayChange = 0;
    for (const r of enriched) {
      invested += r.invested;
      value += r.value;
      dayChange += r.value * (r.dayChange / 100);
    }
    return { invested, value, pnl: value - invested, dayChange };
  }, [enriched]);

  const rows = useMemo(() => {
    let list = enriched;
    if (typeFilter !== "all") list = list.filter((r) => r.assetType === typeFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((r) => r.ticker.toLowerCase().includes(q));
    }
    const sorted = [...list];
    switch (sort) {
      case "value-desc":
        sorted.sort((a, b) => b.value - a.value);
        break;
      case "pnl-desc":
        sorted.sort((a, b) => b.pnl - a.pnl);
        break;
      case "pnl-asc":
        sorted.sort((a, b) => a.pnl - b.pnl);
        break;
      case "ticker":
        sorted.sort((a, b) => a.ticker.localeCompare(b.ticker));
        break;
    }
    return sorted;
  }, [enriched, typeFilter, search, sort]);

  const allocation = useMemo(
    () =>
      rows.map((r, i) => ({
        name: r.ticker,
        value: r.value,
        color: palette[i % palette.length],
      })),
    [rows],
  );

  const typeCounts = useMemo(() => {
    const c: Record<TypeFilter, number> = {
      all: enriched.length,
      stock: 0,
      mf: 0,
    };
    for (const r of enriched) {
      const k = r.assetType as "stock" | "mf";
      if (k in c) c[k]++;
    }
    return c;
  }, [enriched]);

  if (portfolios.isLoading || holdings.isLoading) {
    return (
      <div className="flex h-full items-center justify-center py-24 text-fg-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading holdings…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-fg-muted">Portfolio</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Holdings</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Every position, priced live. Click a row for the full chart + XIRR.
          </p>
        </div>
        <LiveBadge connected={connected} />
      </header>

      <HoldingsHero
        portfolioId={portfolio?.id}
        invested={totals.invested}
        value={totals.value}
        pnl={totals.pnl}
        pnlPct={totals.invested > 0 ? (totals.pnl / totals.invested) * 100 : 0}
        dayChange={totals.dayChange}
        dayChangePct={totals.value > 0 ? (totals.dayChange / totals.value) * 100 : 0}
        allocation={allocation}
        best={topMover.best ? { ticker: topMover.best.ticker, pnl: topMover.best.pnl, pnlPct: topMover.best.pnlPct } : null}
        worst={topMover.worst ? { ticker: topMover.worst.ticker, pnl: topMover.worst.pnl, pnlPct: topMover.worst.pnlPct } : null}
        positionCount={enriched.length}
      />

      {/* Filter bar */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
              <input
                className="input !py-2 !pl-8 !pr-3 w-44 text-sm"
                placeholder="Filter ticker…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-border bg-bg-soft p-0.5">
              {(["all", "stock", "mf"] as TypeFilter[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                    typeFilter === t
                      ? "rounded-md bg-overlay/10 text-fg"
                      : "text-fg-muted hover:text-fg",
                  )}
                >
                  {t}
                  <span className="num rounded-full bg-overlay/5 px-1.5 text-[10px]">
                    {typeCounts[t]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-fg-muted">
            <Filter className="h-3.5 w-3.5" />
            <span>Sort</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="input !py-1.5 !pl-2 !pr-7 text-xs"
            >
              <option value="value-desc">Value · High→Low</option>
              <option value="pnl-desc">P&L · High→Low</option>
              <option value="pnl-asc">P&L · Low→High</option>
              <option value="ticker">Ticker · A→Z</option>
            </select>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="py-14 text-center text-sm text-fg-muted">
            No holdings match your filters.
          </div>
        ) : (
          <>
            {/* Mobile: stacked cards. The 9-column desktop table requires
                horizontal scroll on phones, which users don't expect. Each
                card surfaces the same fields in a vertical layout instead. */}
            <ul className="divide-y divide-border/40 md:hidden">
              {rows.map((r) => {
                const xirrEntry = xirr.byTicker[r.ticker];
                const xirrPct =
                  xirrEntry?.insufficient || xirrEntry?.rate == null
                    ? null
                    : (xirrEntry.rate as number) * 100;
                const allocPct = totals.value > 0 ? (r.value / totals.value) * 100 : 0;
                return (
                  <HoldingCardMobile
                    key={r.id}
                    r={r}
                    xirrPct={xirrPct}
                    allocPct={allocPct}
                    onOpen={() => navigate(assetHref(r.ticker, r.assetType))}
                    onBuy={() =>
                      setTrade({
                        ticker: r.ticker,
                        side: "buy",
                        assetType: r.assetType as Holding["assetType"],
                      })
                    }
                    onSell={() =>
                      setTrade({
                        ticker: r.ticker,
                        side: "sell",
                        assetType: r.assetType as Holding["assetType"],
                      })
                    }
                    onAlert={() => setAlertFor(r.ticker)}
                  />
                );
              })}
            </ul>

            {/* Desktop: full sortable table. */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[20%] min-w-[180px]" />
                <col className="w-[8%]  min-w-[70px]" />
                <col className="w-[10%] min-w-[90px]" />
                <col className="w-[11%] min-w-[100px]" />
                <col className="w-[12%] min-w-[110px]" />
                <col className="w-[13%] min-w-[120px]" />
                <col className="w-[8%]  min-w-[70px]" />
                <col className="w-[7%]  min-w-[60px]" />
                <col className="w-[11%] min-w-[140px]" />
              </colgroup>
              <thead>
                <tr className="border-b border-border/80 text-[11px] uppercase tracking-wider text-fg-muted">
                  <Th align="left">Asset</Th>
                  <Th align="right">Qty</Th>
                  <Th align="right">Avg</Th>
                  <Th align="right">Price</Th>
                  <Th align="right">Value</Th>
                  <Th align="right">P&L</Th>
                  <Th align="right">XIRR</Th>
                  <Th align="right">Alloc</Th>
                  <Th align="right">&nbsp;</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <HoldingRow
                    key={r.id}
                    r={r}
                    index={i}
                    xirrPct={
                      xirr.byTicker[r.ticker]?.insufficient ||
                      xirr.byTicker[r.ticker]?.rate == null
                        ? null
                        : (xirr.byTicker[r.ticker]!.rate as number) * 100
                    }
                    totalValue={totals.value}
                    onOpen={() => navigate(assetHref(r.ticker, r.assetType))}
                    onBuy={() =>
                      setTrade({
                        ticker: r.ticker,
                        side: "buy",
                        assetType: r.assetType as Holding["assetType"],
                      })
                    }
                    onSell={() =>
                      setTrade({
                        ticker: r.ticker,
                        side: "sell",
                        assetType: r.assetType as Holding["assetType"],
                      })
                    }
                    onAlert={() => setAlertFor(r.ticker)}
                  />
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}
      </section>

      {trade && portfolio && (
        <TradeDialog
          open
          onOpenChange={(v) => !v && setTrade(null)}
          portfolioId={portfolio.id}
          ticker={trade.ticker}
          side={trade.side}
          assetType={trade.assetType}
          holding={holdings.data?.find((h) => h.ticker === trade.ticker)}
          livePrice={
            quotes[trade.ticker]
              ? toNum(quotes[trade.ticker].price)
              : toNum(holdings.data?.find((h) => h.ticker === trade.ticker)?.currentPrice)
          }
        />
      )}

      <AlertForm
        open={!!alertFor}
        onOpenChange={(v) => !v && setAlertFor(null)}
        defaultTicker={alertFor ?? undefined}
        currentPrice={
          alertFor && quotes[alertFor] ? toNum(quotes[alertFor].price) : undefined
        }
      />
    </div>
  );
}

interface EnrichedRow {
  id: string;
  ticker: string;
  assetType: string;
  live: number;
  qty: number;
  avg: number;
  invested: number;
  value: number;
  pnl: number;
  pnlPct: number;
  dayChange: number;
}

function HoldingRow({
  r,
  index,
  xirrPct,
  totalValue,
  onOpen,
  onBuy,
  onSell,
  onAlert,
}: {
  r: EnrichedRow;
  index: number;
  xirrPct: number | null;
  totalValue: number;
  onOpen: () => void;
  onBuy: () => void;
  onSell: () => void;
  onAlert: () => void;
}) {
  const allocPct = totalValue > 0 ? (r.value / totalValue) * 100 : 0;

  return (
    <motion.tr
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 10) * 0.02 }}
      onClick={onOpen}
      className="group cursor-pointer border-b border-border/40 align-middle transition-colors last:border-0 hover:bg-overlay/[0.03]"
    >
      {/* Asset */}
      <Td align="left">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-semibold",
              r.assetType === "mf"
                ? "bg-violet-500/15 text-violet-300"
                : "bg-cyan-500/15 text-cyan-300",
            )}
          >
            {r.ticker.slice(0, 2)}
          </span>
          <div className="min-w-0 leading-tight">
            <div className="truncate font-medium group-hover:text-brand">{r.ticker}</div>
            <div className="text-[10px] uppercase text-fg-muted">{r.assetType}</div>
          </div>
          <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5 md:hidden lg:block" />
        </div>
      </Td>

      <Td align="right">
        <span className="num">
          {r.qty.toLocaleString(undefined, { maximumFractionDigits: 8 })}
        </span>
      </Td>

      <Td align="right">
        <span className="num text-fg-muted">{formatCurrency(r.avg)}</span>
      </Td>

      <Td align="right">
        <div className="num">{formatCurrency(r.live)}</div>
        <div className={cn("num text-[11px]", r.dayChange >= 0 ? "pos" : "neg")}>
          {formatPercent(r.dayChange)}
        </div>
      </Td>

      <Td align="right">
        <span className="num font-medium">{formatCurrency(r.value)}</span>
      </Td>

      <Td align="right">
        <div className={cn("num", r.pnl >= 0 ? "pos" : "neg")}>{formatCurrency(r.pnl)}</div>
        <div className={cn("num text-[11px]", r.pnl >= 0 ? "pos" : "neg")}>
          {formatPercent(r.pnlPct)}
        </div>
      </Td>

      <Td align="right">
        <span
          className={cn(
            "num",
            xirrPct == null ? "text-fg-muted" : xirrPct >= 0 ? "pos" : "neg",
          )}
          title={
            xirrPct == null
              ? "XIRR needs buy/sell history spanning days, not minutes. New SIP runs won't show a meaningful rate until they've compounded for a while."
              : undefined
          }
        >
          {xirrPct == null ? "—" : formatPercent(xirrPct)}
        </span>
      </Td>

      <Td align="right">
        <span className="num text-fg-muted">{allocPct.toFixed(1)}%</span>
      </Td>

      {/* Actions — stop propagation so the row click doesn't open detail */}
      <Td align="right" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-0.5">
          <IconBtn onClick={onBuy} label="Buy" tone="success">
            <ArrowDownLeft className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn onClick={onSell} label="Sell" tone="danger">
            <ArrowUpRight className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn onClick={onAlert} label="Set alert">
            <Bell className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn onClick={onOpen} label="Open detail">
            <ExternalLink className="h-3.5 w-3.5" />
          </IconBtn>
        </div>
      </Td>
    </motion.tr>
  );
}

function HoldingCardMobile({
  r,
  xirrPct,
  allocPct,
  onOpen,
  onBuy,
  onSell,
  onAlert,
}: {
  r: EnrichedRow;
  xirrPct: number | null;
  allocPct: number;
  onOpen: () => void;
  onBuy: () => void;
  onSell: () => void;
  onAlert: () => void;
}) {
  return (
    <li
      onClick={onOpen}
      className="cursor-pointer px-4 py-3 transition-colors hover:bg-overlay/[0.03]"
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-semibold",
            r.assetType === "mf"
              ? "bg-violet-500/15 text-violet-300"
              : "bg-cyan-500/15 text-cyan-300",
          )}
        >
          {r.ticker.slice(0, 2)}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-medium">{r.ticker}</div>
          <div className="num text-[11px] text-fg-muted">
            {r.qty.toLocaleString(undefined, { maximumFractionDigits: 8 })} × {formatCurrency(r.avg)}
          </div>
        </div>
        <div className="text-right leading-tight">
          <div className="num text-sm font-medium">{formatCurrency(r.value)}</div>
          <div className={cn("num text-[11px] font-medium", r.pnl >= 0 ? "pos" : "neg")}>
            {r.pnl >= 0 ? "+" : ""}
            {formatCurrency(r.pnl)} · {formatPercent(r.pnlPct)}
          </div>
        </div>
      </div>

      <div className="num mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-muted">
        <span>
          Day{" "}
          <span className={r.dayChange >= 0 ? "pos" : "neg"}>
            {formatPercent(r.dayChange)}
          </span>
        </span>
        <span className="text-fg-subtle">·</span>
        <span>
          XIRR{" "}
          <span className={xirrPct == null ? "text-fg-muted" : xirrPct >= 0 ? "pos" : "neg"}>
            {xirrPct == null ? "—" : formatPercent(xirrPct)}
          </span>
        </span>
        <span className="text-fg-subtle">·</span>
        <span>Alloc {allocPct.toFixed(1)}%</span>
      </div>

      <div
        className="mt-3 flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onBuy}
          className="btn-outline h-9 flex-1 px-2 text-xs"
        >
          <ArrowDownLeft className="h-3.5 w-3.5" /> Buy
        </button>
        <button
          type="button"
          onClick={onSell}
          className="btn-outline h-9 flex-1 px-2 text-xs"
        >
          <ArrowUpRight className="h-3.5 w-3.5" /> Sell
        </button>
        <button
          type="button"
          onClick={onAlert}
          aria-label="Set alert"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-fg-muted hover:bg-overlay/5 hover:text-fg"
        >
          <Bell className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onOpen}
          aria-label="Open detail"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-fg-muted hover:bg-overlay/5 hover:text-fg"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

function Th({
  align,
  children,
}: {
  align: "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <th
      className={cn(
        "px-3 py-3 font-medium",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

function Td({
  align,
  children,
  onClick,
}: {
  align: "left" | "right";
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <td
      onClick={onClick}
      className={cn(
        "px-3 py-3",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </td>
  );
}

function IconBtn({
  onClick,
  label,
  tone,
  children,
}: {
  onClick: () => void;
  label: string;
  tone?: "success" | "danger";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-overlay/5",
        tone === "success" && "hover:text-success",
        tone === "danger" && "hover:text-danger",
        !tone && "hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

