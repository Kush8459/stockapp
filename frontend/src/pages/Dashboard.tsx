import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Download, Loader2 } from "lucide-react";
import { useHoldings, usePortfolios, useSummary, useTransactions } from "@/hooks/usePortfolio";
import { useLivePrices } from "@/hooks/useLivePrices";
import { usePortfolioXirr } from "@/hooks/usePnl";
import { assetHref, cn, formatPercent, toNum } from "@/lib/utils";
import { downloadCsv, toCsv } from "@/lib/csv";
import { useAuth } from "@/store/auth";
import { HoldingsTable, type HoldingRow } from "@/components/HoldingsTable";
import { TradeDialog } from "@/components/TradeDialog";
import { BenchmarkChart } from "@/components/BenchmarkChart";
import { DashboardHero } from "@/components/DashboardHero";
import { LiveBadge } from "@/components/LiveBadge";
import { MarketMovers } from "@/components/MarketMovers";
import { OnboardingCard } from "@/components/OnboardingCard";
import { WalletDialog } from "@/components/WalletDialog";

export function DashboardPage() {
  const navigate = useNavigate();
  const portfolios = usePortfolios();
  const portfolio = portfolios.data?.[0];
  const holdings = useHoldings(portfolio?.id);
  const summary = useSummary(portfolio?.id);
  const xirr = usePortfolioXirr(portfolio?.id);
  const transactions = useTransactions();
  const user = useAuth((s) => s.user);
  const { quotes, connected } = useLivePrices();

  const [trade, setTrade] = useState<{ open: boolean; ticker: string; side: "buy" | "sell" }>({
    open: false,
    ticker: "",
    side: "buy",
  });
  const [walletOpen, setWalletOpen] = useState(false);

  // Track price flashes to animate up/down pulses when a new tick arrives.
  const prevPrices = useRef<Record<string, number>>({});
  const [flashes, setFlashes] = useState<Record<string, "up" | "down" | undefined>>({});
  useEffect(() => {
    const next: Record<string, "up" | "down" | undefined> = {};
    for (const [t, q] of Object.entries(quotes)) {
      const p = toNum(q.price);
      const prev = prevPrices.current[t];
      if (typeof prev === "number" && prev !== p) {
        next[t] = p > prev ? "up" : "down";
      }
      prevPrices.current[t] = p;
    }
    if (Object.keys(next).length) {
      setFlashes(next);
      const id = window.setTimeout(() => setFlashes({}), 750);
      return () => window.clearTimeout(id);
    }
  }, [quotes]);

  const rows: HoldingRow[] = useMemo(() => {
    return (holdings.data ?? []).map((h) => {
      const q = quotes[h.ticker];
      return {
        ...h,
        livePrice: q ? toNum(q.price) : undefined,
        livePriceFlash: flashes[h.ticker],
      };
    });
  }, [holdings.data, quotes, flashes]);

  // Live re-computed summary: overrides the backend's snapshot using the very
  // latest WebSocket prices so the hero cards feel alive.
  const liveSummary = useMemo(() => {
    if (!rows.length) return null;
    let invested = 0;
    let value = 0;
    let dayChange = 0;
    for (const r of rows) {
      const qty = toNum(r.quantity);
      const price = r.livePrice ?? toNum(r.currentPrice);
      const dayPct = toNum(quotes[r.ticker]?.changePct ?? r.dayChangePct);
      invested += toNum(r.avgBuyPrice) * qty;
      value += price * qty;
      dayChange += price * qty * (dayPct / 100);
    }
    const pnl = value - invested;
    const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
    return { invested, value, pnl, pnlPct, dayChange };
  }, [rows, quotes]);

  // (The old `allocation` and `topMovers` derivations are gone — the
  // hero card computes its own movers from `rows`, and the dashboard no
  // longer renders a stand-alone allocation pie at this level.)

  if (portfolios.isLoading || holdings.isLoading) {
    return (
      <div className="flex h-full items-center justify-center py-24 text-fg-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const s = liveSummary ?? {
    invested: toNum(summary.data?.invested),
    value: toNum(summary.data?.currentValue),
    pnl: toNum(summary.data?.pnl),
    pnlPct: toNum(summary.data?.pnlPercent),
    dayChange: toNum(summary.data?.dayChange),
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-fg-muted">Portfolio</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {portfolio?.name ?? "—"}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() =>
              exportStatement({
                user,
                portfolio: portfolio
                  ? { name: portfolio.name, id: portfolio.id, baseCcy: portfolio.baseCcy }
                  : null,
                summary: liveSummary ?? null,
                rows,
                transactions: transactions.data ?? [],
              })
            }
            disabled={!portfolio || rows.length === 0}
            className="btn-outline h-8 px-3 text-xs"
            title="Download portfolio snapshot + full transaction history as CSV"
          >
            <Download className="h-3.5 w-3.5" /> Download statement
          </button>
          <LiveBadge connected={connected} />
        </div>
      </header>

      <OnboardingCard onAddFunds={() => setWalletOpen(true)} />

      <DashboardHero
        portfolioId={portfolio?.id}
        invested={s.invested}
        value={s.value}
        pnl={s.pnl}
        pnlPct={s.pnlPct}
        dayChange={s.dayChange}
        dayChangePct={s.value > 0 ? (s.dayChange / s.value) * 100 : 0}
        rows={rows}
      />

      {/* XIRR pill — kept as a small secondary card; rate doesn't fit the
          headline ribbon well but we still want to surface it. */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <XirrCard
          rate={xirr.data?.insufficient ? null : xirr.data?.rate ?? null}
          loading={xirr.isLoading}
          flowCount={xirr.data?.flowCount ?? 0}
          index={0}
        />
      </section>

      <BenchmarkChart portfolioId={portfolio?.id} />

      <MarketMovers />

      {portfolio && (
        <HoldingsTable
          rows={rows}
          onTrade={(ticker, side) => setTrade({ open: true, ticker, side })}
          onOpen={(ticker) =>
            navigate(
              assetHref(
                ticker,
                rows.find((r) => r.ticker === ticker)?.assetType,
              ),
            )
          }
        />
      )}

      {trade.open && portfolio && (
        <TradeDialog
          open={trade.open}
          onOpenChange={(v) => setTrade((t) => ({ ...t, open: v }))}
          portfolioId={portfolio.id}
          ticker={trade.ticker}
          side={trade.side}
          assetType={rows.find((r) => r.ticker === trade.ticker)?.assetType as "stock" | "mf" | undefined}
          holding={holdings.data?.find((h) => h.ticker === trade.ticker)}
          livePrice={
            quotes[trade.ticker]
              ? toNum(quotes[trade.ticker].price)
              : toNum(rows.find((r) => r.ticker === trade.ticker)?.currentPrice)
          }
        />
      )}

      <WalletDialog open={walletOpen} onOpenChange={setWalletOpen} />
    </div>
  );
}

function XirrCard({
  rate,
  loading,
  flowCount,
  index,
}: {
  rate: number | null;
  loading: boolean;
  flowCount: number;
  index: number;
}) {
  const pct = rate !== null ? rate * 100 : null;
  const positive = pct !== null && pct >= 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: index * 0.05, ease: [0.2, 0.8, 0.2, 1] }}
      className="card p-5"
    >
      <div className="flex items-center justify-between">
        <span className="label">XIRR</span>
        <span className="chip num">{flowCount} flows</span>
      </div>
      <div
        className={cn(
          "mt-3 text-3xl font-semibold tracking-tight num",
          pct === null ? "text-fg-muted" : positive ? "text-success" : "text-danger",
        )}
      >
        {loading ? "…" : pct === null ? "—" : formatPercent(pct)}
      </div>
      <div className="mt-1 text-xs text-fg-muted">
        {pct === null
          ? "Needs buy/sell history spanning days, not minutes"
          : "Annualized, cash-flow weighted"}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// CSV statement export
// ---------------------------------------------------------------------------

interface ExportArgs {
  user: { email: string; displayName?: string } | null;
  portfolio: { name: string; id: string; baseCcy: string } | null;
  summary: {
    invested: number;
    value: number;
    pnl: number;
    pnlPct: number;
    dayChange: number;
  } | null;
  rows: HoldingRow[];
  transactions: Array<{
    id: string;
    executedAt: string;
    side: string;
    source: string;
    ticker: string;
    assetType: string;
    quantity: string;
    price: string;
    totalAmount: string;
    fees: string;
    note?: string | null;
  }>;
}

/**
 * Build a single CSV with three stacked sections: summary, holdings,
 * transactions. Keeping it one file (rather than a zip) makes it easy for
 * a CA or spreadsheet to open without extra tooling.
 */
function exportStatement({ user, portfolio, summary, rows, transactions }: ExportArgs) {
  const now = new Date();
  const fname = `statement-${now.toISOString().slice(0, 10)}.csv`;

  const out: Array<Array<string | number>> = [];
  out.push(["Portfolio Statement"]);
  out.push(["Generated", now.toISOString()]);
  if (user) out.push(["Account", user.displayName ?? "", user.email]);
  if (portfolio) {
    out.push(["Portfolio", portfolio.name, portfolio.id, `Base: ${portfolio.baseCcy}`]);
  }
  out.push([]);

  out.push(["Summary"]);
  out.push(["Invested", "Current value", "P&L", "P&L %", "Day change"]);
  out.push([
    summary?.invested ?? 0,
    summary?.value ?? 0,
    summary?.pnl ?? 0,
    summary?.pnlPct ?? 0,
    summary?.dayChange ?? 0,
  ]);
  out.push([]);

  out.push(["Holdings"]);
  out.push([
    "Ticker", "Asset type", "Quantity", "Avg buy", "Current price",
    "Invested", "Current value", "P&L", "P&L %", "Day change %",
  ]);
  for (const r of rows) {
    const live = r.livePrice ?? toNum(r.currentPrice);
    const qty = toNum(r.quantity);
    const avg = toNum(r.avgBuyPrice);
    const invested = qty * avg;
    const value = qty * live;
    const pnl = value - invested;
    const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
    out.push([
      r.ticker, r.assetType,
      qty, avg, live, invested, value, pnl, pnlPct,
      toNum(r.dayChangePct),
    ]);
  }
  out.push([]);

  out.push(["Transactions"]);
  out.push([
    "Date", "Side", "Source", "Ticker", "Asset",
    "Quantity", "Price", "Total", "Fees", "Note", "ID",
  ]);
  for (const t of transactions) {
    out.push([
      new Date(t.executedAt).toISOString(),
      t.side, t.source, t.ticker, t.assetType,
      t.quantity, t.price, t.totalAmount, t.fees,
      t.note ?? "", t.id,
    ]);
  }

  downloadCsv(fname, toCsv(out));
}
