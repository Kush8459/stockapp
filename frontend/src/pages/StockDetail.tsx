import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { LiveChart, type Point } from "@/components/LiveChart";
import { TradeDialog } from "@/components/TradeDialog";
import { AlertForm } from "@/components/AlertForm";
import { NewsFeed } from "@/components/NewsFeed";
import { RangeSelector } from "@/components/RangeSelector";
import { StockHero } from "@/components/StockHero";
import { FundamentalsCard } from "@/components/FundamentalsCard";
import { FinancialsCard } from "@/components/FinancialsCard";
import { EventsCard } from "@/components/EventsCard";
import { AboutCard } from "@/components/AboutCard";
import { useHoldings, usePortfolios, useTransactions } from "@/hooks/usePortfolio";
import { useHoldingXirr } from "@/hooks/usePnl";
import { usePriceHistory } from "@/hooks/usePriceHistory";
import { useCandles, type ChartRange } from "@/hooks/useCandles";
import { useLivePrices } from "@/hooks/useLivePrices";
import { useDividends } from "@/hooks/useDividends";
import { cn, formatCurrency, formatPercent, toNum } from "@/lib/utils";

export function StockDetailPage() {
  const { ticker: rawTicker } = useParams();
  const ticker = rawTicker?.toUpperCase() ?? "";
  const navigate = useNavigate();

  const portfolios = usePortfolios();
  const portfolio = portfolios.data?.[0];
  const holdings = useHoldings(portfolio?.id);
  const transactions = useTransactions();
  const dividends = useDividends(ticker);
  const [range, setRange] = useState<ChartRange>("1y");
  const intradayHistory = usePriceHistory(range === "1d" ? ticker : undefined);
  const candles = useCandles(range === "1d" ? undefined : ticker, range);
  const xirr = useHoldingXirr(portfolio?.id, ticker);
  const { quotes, connected } = useLivePrices();

  const holding = useMemo(
    () => (holdings.data ?? []).find((h) => h.ticker === ticker),
    [holdings.data, ticker],
  );
  const live = quotes[ticker];

  const candleFallback = useMemo(() => {
    const items = candles.data ?? [];
    if (items.length === 0) return null;
    const last = items[items.length - 1];
    const prev = items.length > 1 ? items[items.length - 2] : null;
    const changePct =
      prev && prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : 0;
    return { close: last.close, time: last.time, changePct };
  }, [candles.data]);

  const livePrice = live
    ? toNum(live.price)
    : toNum(holding?.currentPrice) || candleFallback?.close || 0;
  const dayChangePct = live
    ? toNum(live.changePct)
    : toNum(holding?.dayChangePct) || candleFallback?.changePct || 0;
  const priceAsOf = live
    ? "live"
    : candleFallback
      ? new Date(candleFallback.time * 1000).toLocaleDateString(undefined, {
          day: "2-digit",
          month: "short",
        })
      : null;
  const hasLiveStream = !!live;

  const [trade, setTrade] = useState<null | { side: "buy" | "sell" }>(null);
  const [showAlert, setShowAlert] = useState(false);

  const seed: Point[] = useMemo(() => {
    if (range === "1d") {
      return (intradayHistory.data ?? []).map((q) => ({
        time: Math.floor(new Date(q.updatedAt).getTime() / 1000),
        value: toNum(q.price),
      }));
    }
    return (candles.data ?? []).map((c) => ({
      time: c.time,
      value: c.close,
    }));
  }, [range, intradayHistory.data, candles.data]);

  const [lastTick, setLastTick] = useState<Point | null>(null);
  useEffect(() => {
    if (range !== "1d" || !live) return;
    setLastTick({
      time: Math.floor(new Date(live.updatedAt).getTime() / 1000),
      value: toNum(live.price),
    });
  }, [range, live]);
  useEffect(() => setLastTick(null), [range]);

  const chartLoading =
    (range === "1d" && intradayHistory.isLoading) ||
    (range !== "1d" && candles.isLoading);

  // Position-derived figures.
  const qty = toNum(holding?.quantity);
  const avg = toNum(holding?.avgBuyPrice);
  const invested = qty * avg;
  const value = qty * livePrice;
  const pnl = value - invested;
  const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;

  const totalDividends = useMemo(
    () => (dividends.data ?? []).reduce((s, d) => s + toNum(d.netAmount), 0),
    [dividends.data],
  );

  const firstBuyAt = useMemo(() => {
    const list = (transactions.data ?? [])
      .filter((t) => t.ticker === ticker && t.side === "buy")
      .sort(
        (a, b) =>
          new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime(),
      );
    return list[0]?.executedAt ?? null;
  }, [transactions.data, ticker]);
  const holdingPeriod = firstBuyAt ? formatHoldingPeriod(firstBuyAt) : null;

  if (!ticker) return null;

  if (portfolios.isLoading || holdings.isLoading) {
    return (
      <div className="flex h-full items-center justify-center py-24 text-fg-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading {ticker}…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <button
        type="button"
        onClick={() => navigate("/")}
        className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </button>

      <StockHero
        ticker={ticker}
        livePrice={livePrice}
        dayChangePct={dayChangePct}
        hasLiveStream={hasLiveStream}
        priceAsOf={priceAsOf}
        connected={connected}
        holding={holding}
        onBuy={() => setTrade({ side: "buy" })}
        onSell={() => setTrade({ side: "sell" })}
        onAlert={() => setShowAlert(true)}
      />

      <section className="card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="label">Price chart</div>
            <div className="num text-xs text-fg-muted">
              {chartLoading
                ? "loading…"
                : seed.length === 0
                  ? "no data"
                  : `${seed.length} points${range === "1d" ? (connected ? " · streaming" : " · paused") : ` · ${range.toUpperCase()} history`}`}
            </div>
          </div>
          <RangeSelector value={range} onChange={setRange} />
        </div>
        {chartLoading ? (
          <div className="flex h-[260px] items-center justify-center text-sm text-fg-muted">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading {range.toUpperCase()} history…
          </div>
        ) : seed.length === 0 ? (
          <div className="flex h-[260px] items-center justify-center text-sm text-fg-muted">
            {range === "1d"
              ? "Waiting for ticks — make sure the price worker is running."
              : "No historical data available for this ticker at this range."}
          </div>
        ) : (
          <LiveChart history={seed} lastTick={range === "1d" ? lastTick : null} />
        )}
      </section>

      {/* My position + trade actions */}
      <section>
        <div className="card p-5">
          <div className="label mb-3">My position</div>
          {holding && qty > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-4">
                <Stat label="Quantity" value={qty.toLocaleString()} />
                <Stat label="Avg buy" value={formatCurrency(avg)} />
                <Stat label="Invested" value={formatCurrency(invested)} />
                <Stat label="Value" value={formatCurrency(value)} />

                <Stat
                  label="P&L"
                  value={formatCurrency(pnl)}
                  tone={pnl >= 0 ? "pos" : "neg"}
                />
                <Stat
                  label="P&L %"
                  value={formatPercent(pnlPct)}
                  tone={pnl >= 0 ? "pos" : "neg"}
                />
                <Stat label="Day change" value={formatPercent(dayChangePct)} />
                <Stat
                  label="XIRR"
                  value={
                    xirr.data?.insufficient ||
                    xirr.data?.rate === null ||
                    xirr.isLoading
                      ? "—"
                      : formatPercent((xirr.data?.rate ?? 0) * 100)
                  }
                  tone={
                    xirr.data?.rate && xirr.data.rate >= 0
                      ? "pos"
                      : xirr.data?.rate && xirr.data.rate < 0
                        ? "neg"
                        : undefined
                  }
                />
              </div>
              <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 border-t border-border/40 pt-4 text-sm sm:grid-cols-3">
                <Stat
                  label="Holding period"
                  value={holdingPeriod ?? "—"}
                  hint={
                    firstBuyAt
                      ? `since ${new Date(firstBuyAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`
                      : undefined
                  }
                />
                <Stat
                  label="Dividends received"
                  value={formatCurrency(totalDividends)}
                  tone={totalDividends > 0 ? "pos" : undefined}
                  hint={
                    (dividends.data?.length ?? 0) > 0
                      ? `${dividends.data!.length} payment${dividends.data!.length === 1 ? "" : "s"}`
                      : "auto-tracked from Yahoo events"
                  }
                />
                <Stat
                  label="Total return"
                  value={formatPercent(invested > 0 ? ((pnl + totalDividends) / invested) * 100 : 0)}
                  tone={pnl + totalDividends >= 0 ? "pos" : "neg"}
                  hint="P&L + dividends"
                />
              </div>
            </>
          ) : (
            <div className="text-sm text-fg-muted">
              You don't have a position in {ticker} yet.
            </div>
          )}
        </div>

      </section>

      {/* Stock-info sections, in order */}
      <EventsCard ticker={ticker} />
      <FundamentalsCard ticker={ticker} currentPrice={livePrice} />
      <FinancialsCard ticker={ticker} />
      <AboutCard ticker={ticker} />
      <NewsFeed ticker={ticker} />

      <AlertForm
        open={showAlert}
        onOpenChange={setShowAlert}
        defaultTicker={ticker}
        currentPrice={livePrice}
      />

      {trade && portfolio && (
        <TradeDialog
          open
          onOpenChange={(v) => !v && setTrade(null)}
          portfolioId={portfolio.id}
          ticker={ticker}
          side={trade.side}
          assetType={holding?.assetType as "stock" | "mf" | undefined}
          holding={holding}
          livePrice={livePrice}
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
  hint?: string;
}) {
  return (
    <div>
      <div className="label">{label}</div>
      <div
        className={cn(
          "num mt-1 text-base font-medium",
          tone === "pos" && "pos",
          tone === "neg" && "neg",
        )}
      >
        {value}
      </div>
      {hint && <div className="text-[10px] text-fg-subtle">{hint}</div>}
    </div>
  );
}

function formatHoldingPeriod(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 0) return "—";
  if (days < 30) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 365) {
    const months = Math.round(days / 30);
    return `${months} month${months === 1 ? "" : "s"}`;
  }
  const years = days / 365;
  return `${years.toFixed(1)} years`;
}
