import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  Loader2,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet2,
} from "lucide-react";
import { LiveChart, type Point } from "@/components/LiveChart";
import { RangeSelector } from "@/components/RangeSelector";
import { LiveBadge } from "@/components/LiveBadge";
import { MfInvestDialog } from "@/components/MfInvestDialog";
import { MfMetricsCard } from "@/components/MfMetricsCard";
import { MfRedeemDialog } from "@/components/MfRedeemDialog";
import { MfReturnCalculator } from "@/components/MfReturnCalculator";
import { MfSimilarFunds } from "@/components/MfSimilarFunds";
import {
  useMfFund,
  useMfMetrics,
  useMfReturns,
  type MfReturns,
} from "@/hooks/useMfCatalog";
import { useCandles, type ChartRange } from "@/hooks/useCandles";
import { useLivePrices } from "@/hooks/useLivePrices";
import { useHoldings, usePortfolios } from "@/hooks/usePortfolio";
import { cn, formatCurrency, formatPercent, toNum } from "@/lib/utils";

export function MutualFundDetailPage() {
  const { ticker: rawTicker } = useParams();
  const ticker = rawTicker?.toUpperCase() ?? "";
  const navigate = useNavigate();

  const portfolios = usePortfolios();
  const portfolio = portfolios.data?.[0];
  const holdings = useHoldings(portfolio?.id);
  const fund = useMfFund(ticker);
  const returns = useMfReturns(ticker);
  const metrics = useMfMetrics(ticker);
  const [range, setRange] = useState<ChartRange>("1y");
  const candles = useCandles(ticker || undefined, range);
  const { quotes, connected } = useLivePrices();

  const holding = useMemo(
    () => (holdings.data ?? []).find((h) => h.ticker === ticker),
    [holdings.data, ticker],
  );
  const live = quotes[ticker];

  const livePrice = live
    ? toNum(live.price)
    : toNum(fund.data?.nav?.value) || toNum(returns.data?.navCurrent);
  const dayChangePct = live
    ? toNum(live.changePct)
    : toNum(fund.data?.nav?.changePct ?? "");
  const navAsOf = live ? "live" : fund.data?.nav?.asOf ?? returns.data?.navAsOf;
  const hasLiveStream = !!live;

  const chartSeed: Point[] = useMemo(
    () =>
      (candles.data ?? []).map((c) => ({
        time: c.time,
        value: c.close,
      })),
    [candles.data],
  );

  const [invest, setInvest] = useState<null | "lumpsum" | "sip">(null);
  const [redeemOpen, setRedeemOpen] = useState(false);

  // Position-derived figures (units, not shares).
  const units = toNum(holding?.quantity);
  const avgNav = toNum(holding?.avgBuyPrice);
  const invested = units * avgNav;
  const value = units * livePrice;
  const pnl = value - invested;
  const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;

  if (!ticker) return null;

  if (fund.isLoading) {
    return (
      <div className="flex h-full items-center justify-center py-24 text-fg-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading {ticker}…
      </div>
    );
  }
  if (fund.isError || !fund.data) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 py-12 text-center">
        <p className="text-sm text-fg-muted">
          Couldn't load this fund. It may not be in the catalog.
        </p>
        <button
          type="button"
          onClick={() => navigate("/funds")}
          className="btn-outline text-xs"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to mutual funds
        </button>
      </div>
    );
  }

  const f = fund.data;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <button
        type="button"
        onClick={() => navigate("/funds")}
        className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" /> Back to mutual funds
      </button>

      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex flex-wrap items-end justify-between gap-4"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wider text-fg-muted">
            <span>{f.amc}</span>
            <span className="text-fg-subtle">·</span>
            <span className="chip text-[10px] normal-case tracking-normal">
              {f.category}
            </span>
            <span className="text-fg-subtle">·</span>
            <span>{f.planType} Plan · {f.option}</span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {f.name}
          </h1>
        </div>
        <div className="flex items-end gap-5">
          <div className="text-right">
            <div className="label">NAV</div>
            <div className="num text-2xl font-semibold">
              {formatCurrency(livePrice)}
            </div>
            {navAsOf && (
              <div className="num text-[10px] text-fg-subtle">
                {hasLiveStream
                  ? "real-time"
                  : `as of ${formatNavDate(navAsOf)}`}
              </div>
            )}
          </div>
          {fund.data.nav?.changePct && (
            <span
              className={cn(
                "chip",
                dayChangePct >= 0
                  ? "border-success/30 text-success"
                  : "border-danger/30 text-danger",
              )}
            >
              {formatPercent(dayChangePct)} d
            </span>
          )}
          <LiveBadge connected={connected} hasQuote={hasLiveStream} />
        </div>
      </motion.header>

      {/* Chart */}
      <section className="card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="label">NAV chart</div>
            <div className="num text-xs text-fg-muted">
              {candles.isLoading
                ? "loading…"
                : chartSeed.length === 0
                  ? "no data"
                  : `${chartSeed.length} points · ${range.toUpperCase()} history`}
            </div>
          </div>
          <RangeSelector value={range} onChange={setRange} />
        </div>
        {candles.isLoading ? (
          <div className="flex h-[260px] items-center justify-center text-sm text-fg-muted">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : chartSeed.length === 0 ? (
          <div className="flex h-[260px] items-center justify-center text-sm text-fg-muted">
            No NAV history available at this range.
          </div>
        ) : (
          <LiveChart history={chartSeed} lastTick={null} />
        )}
      </section>

      {/* Returns table */}
      <ReturnsCard returns={returns.data} loading={returns.isLoading} />

      {/* My position + invest CTAs */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="label mb-3">My position</div>
          {holding && units > 0 ? (
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-4">
              <Stat label="Units" value={units.toFixed(4)} />
              <Stat label="Avg NAV" value={formatCurrency(avgNav)} />
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
              <Stat
                label="Day change"
                value={formatPercent(dayChangePct)}
                tone={dayChangePct >= 0 ? "pos" : "neg"}
              />
            </div>
          ) : (
            <div className="text-sm text-fg-muted">
              You don't own this fund yet. Start with a lumpsum or set up a
              recurring SIP — both invest at the latest NAV.
            </div>
          )}
        </div>

        <div className="card flex flex-col gap-3 p-5">
          <div className="label">
            {holding && units > 0 ? "Manage" : "Invest"}
          </div>
          <button
            className="btn-primary w-full"
            onClick={() => setInvest("lumpsum")}
            disabled={!portfolio}
          >
            <Wallet2 className="h-4 w-4" /> Lumpsum
          </button>
          <button
            className="btn-outline w-full"
            onClick={() => setInvest("sip")}
            disabled={!portfolio}
          >
            <CalendarClock className="h-4 w-4" /> Start SIP
          </button>
          {holding && units > 0 && (
            <button
              className="btn-outline w-full border-warn/40 text-warn hover:bg-warn/10"
              onClick={() => setRedeemOpen(true)}
              disabled={!portfolio}
            >
              <ArrowUpRight className="h-4 w-4" /> Redeem
            </button>
          )}
          <p className="text-[11px] text-fg-muted">
            {holding && units > 0
              ? "Lumpsum and SIP add to your position; Redeem sells units back at the current NAV."
              : "Lumpsum buys at the latest NAV. SIP runs automatically at your chosen cadence and invests at that day's NAV."}
          </p>
        </div>
      </section>

      {/* Return calculator — what-if at any expected rate */}
      <MfReturnCalculator
        suggestedRate={
          returns.data?.fiveYear ?? returns.data?.threeYear ?? returns.data?.oneYear ?? undefined
        }
      />

      {/* Risk & performance */}
      <MfMetricsCard metrics={metrics.data} loading={metrics.isLoading} />

      {/* Fund details */}
      <FundDetailsCard fund={f} returns={returns.data} />

      {/* Similar funds — same category */}
      <MfSimilarFunds category={f.category} excludeTicker={f.ticker} />

      {invest && (
        <MfInvestDialog
          open
          onOpenChange={(v) => !v && setInvest(null)}
          fund={f}
          defaultMode={invest}
        />
      )}

      {redeemOpen && portfolio && (
        <MfRedeemDialog
          open={redeemOpen}
          onOpenChange={setRedeemOpen}
          fund={f}
          holding={holding}
          livePrice={livePrice}
          portfolioId={portfolio.id}
        />
      )}
    </div>
  );
}

// ── Returns heatmap ─────────────────────────────────────────────────────

interface ReturnsCell {
  label: string;
  value: number | undefined;
  annualized: boolean;
}

function ReturnsCard({
  returns,
  loading,
}: {
  returns: MfReturns | undefined;
  loading: boolean;
}) {
  const cells: ReturnsCell[] = [
    { label: "1M", value: returns?.oneMonth, annualized: false },
    { label: "3M", value: returns?.threeMonth, annualized: false },
    { label: "6M", value: returns?.sixMonth, annualized: false },
    { label: "1Y", value: returns?.oneYear, annualized: false },
    { label: "3Y", value: returns?.threeYear, annualized: true },
    { label: "5Y", value: returns?.fiveYear, annualized: true },
    { label: "10Y", value: returns?.tenYear, annualized: true },
    {
      label: "All",
      value: returns?.sinceInception,
      annualized: (returns?.historyDays ?? 0) >= 365,
    },
  ];

  // Pull the strongest +/- in the row to anchor the legend swatches. Falls
  // back to ±20% so a flat row still shows distinguishable colour stops.
  const valid = cells.map((c) => c.value).filter((v): v is number => typeof v === "number");
  const maxAbs = Math.max(20, ...valid.map((v) => Math.abs(v)));

  return (
    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="label flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5" />
            Returns
          </div>
          <div className="text-xs text-fg-muted">
            ≤ 1y are absolute · ≥ 3y are annualised CAGR. Hover any cell.
          </div>
        </div>
        {returns && (
          <div className="text-right text-[11px] text-fg-subtle">
            <div>
              since {formatNavDate(returns.inceptionDate)} ·{" "}
              {returns.historyDays.toLocaleString()} days
            </div>
            <ColorLegend maxAbs={maxAbs} />
          </div>
        )}
      </div>
      {loading && !returns ? (
        <div className="flex h-24 items-center justify-center text-sm text-fg-muted">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> computing returns…
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-1.5 md:grid-cols-8">
          {cells.map((c) => (
            <HeatmapCell key={c.label} cell={c} maxAbs={maxAbs} />
          ))}
        </div>
      )}
    </section>
  );
}

// returnTone maps a percentage return to an RGBA fill + foreground colour.
// Negative returns walk red 50→700, positive returns walk green 50→700,
// scaled by intensity ∈ [0,1] so a 25% gain isn't drawn the same as a 5%
// gain.
function returnTone(
  value: number,
  maxAbs: number,
): { fill: string; border: string; text: string } {
  const intensity = Math.min(1, Math.abs(value) / maxAbs);
  if (Math.abs(value) < 0.5) {
    // Near-zero band: muted neutral. Avoids painting a "barely positive
    // 0.1%" cell with the same green as a real 5% gain.
    return {
      fill: "rgba(148, 163, 184, 0.10)",
      border: "rgba(148, 163, 184, 0.25)",
      text: "var(--fg-muted, #8a95a6)",
    };
  }
  if (value < 0) {
    const a = 0.18 + intensity * 0.42;
    return {
      fill: `rgba(239, 68, 68, ${a.toFixed(2)})`,
      border: `rgba(239, 68, 68, ${(0.4 + intensity * 0.4).toFixed(2)})`,
      // Use a brighter red for high-intensity cells so the % stays legible.
      text: intensity > 0.55 ? "#fecaca" : "#fca5a5",
    };
  }
  const a = 0.18 + intensity * 0.42;
  return {
    fill: `rgba(16, 185, 129, ${a.toFixed(2)})`,
    border: `rgba(16, 185, 129, ${(0.4 + intensity * 0.4).toFixed(2)})`,
    text: intensity > 0.55 ? "#a7f3d0" : "#86efac",
  };
}

function HeatmapCell({ cell, maxAbs }: { cell: ReturnsCell; maxAbs: number }) {
  if (cell.value === undefined || cell.value === null) {
    return (
      <div
        className="flex h-20 flex-col justify-between rounded-lg border border-dashed border-border/40 bg-bg-soft/30 p-2.5"
        title={`${cell.label} — no data yet`}
      >
        <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
          {cell.label}
        </div>
        <div className="num text-sm text-fg-subtle">—</div>
      </div>
    );
  }
  const tone = returnTone(cell.value, maxAbs);
  const positive = cell.value >= 0;
  const ArrowIcon = positive ? TrendingUp : TrendingDown;
  return (
    <div
      title={`${cell.label} · ${formatPercent(cell.value)} ${cell.annualized ? "p.a." : "absolute"}`}
      className="flex h-20 flex-col justify-between rounded-lg border p-2.5 transition-transform hover:scale-[1.03]"
      style={{ backgroundColor: tone.fill, borderColor: tone.border }}
    >
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-fg-muted">
        <span>{cell.label}</span>
        <span className="text-[9px] text-fg-subtle">
          {cell.annualized ? "p.a." : "abs"}
        </span>
      </div>
      <div
        className="num flex items-center gap-1 text-sm font-semibold"
        style={{ color: tone.text }}
      >
        <ArrowIcon className="h-3.5 w-3.5" />
        {positive ? "+" : ""}
        {cell.value.toFixed(2)}%
      </div>
    </div>
  );
}

// ColorLegend renders three tiny swatches in the header so users can
// decode the heatmap at a glance: deep red (worst end), neutral, deep
// green (best end). The intensity matches the largest |return| in the row.
function ColorLegend({ maxAbs }: { maxAbs: number }) {
  const stops = [-maxAbs, 0, maxAbs];
  return (
    <div className="mt-1 flex items-center gap-1">
      <span className="text-[10px] text-fg-subtle">−{maxAbs.toFixed(0)}%</span>
      {stops.map((v) => {
        const t = returnTone(v, maxAbs);
        return (
          <span
            key={v}
            className="h-2 w-4 rounded-sm border"
            style={{ backgroundColor: t.fill, borderColor: t.border }}
          />
        );
      })}
      <span className="text-[10px] text-fg-subtle">+{maxAbs.toFixed(0)}%</span>
    </div>
  );
}

// ── Fund details card ───────────────────────────────────────────────────

function FundDetailsCard({
  fund,
  returns,
}: {
  fund: { schemeCode: number; amc: string; category: string; planType: string; option: string };
  returns: MfReturns | undefined;
}) {
  return (
    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="label">Information</div>
        <a
          href={`https://www.amfiindia.com/spages/NAVAll.txt`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-fg-muted hover:text-fg"
        >
          AMFI source ↗
        </a>
      </div>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm md:grid-cols-3">
        <Detail term="AMC" detail={fund.amc} />
        <Detail term="Category" detail={fund.category} />
        <Detail term="AMFI scheme code" detail={String(fund.schemeCode)} />
        <Detail term="Plan" detail={`${fund.planType} · ${fund.option}`} />
        {returns && (
          <>
            <Detail
              term="Inception (oldest NAV)"
              detail={formatNavDate(returns.inceptionDate)}
            />
            <Detail
              term="History"
              detail={`${returns.historyDays.toLocaleString()} days`}
            />
            {returns.highestNav && returns.highestNavDate && (
              <Detail
                term="All-time high NAV"
                detail={`${formatCurrency(toNum(returns.highestNav))} (${formatNavDate(returns.highestNavDate)})`}
              />
            )}
            {returns.lowestNav && returns.lowestNavDate && (
              <Detail
                term="All-time low NAV"
                detail={`${formatCurrency(toNum(returns.lowestNav))} (${formatNavDate(returns.lowestNavDate)})`}
              />
            )}
          </>
        )}
      </dl>

      <div className="mt-5 rounded-lg border border-border/60 bg-bg-soft/40 p-3">
        <div className="text-[11px] font-medium text-fg-muted">
          Data not available here
        </div>
        <p className="mt-1 text-[11px] text-fg-subtle">
          AMFI's NAV feed (our source) doesn't publish AUM, expense ratio,
          fund manager, exit load, or portfolio holdings. For those, check
          the AMC's official factsheet — search{" "}
          <span className="text-fg">"{fund.amc} {fund.category} factsheet"</span>{" "}
          or visit{" "}
          <a
            href="https://www.morningstar.in/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand hover:underline"
          >
            morningstar.in
          </a>
          .
        </p>
      </div>

      <p className="mt-3 text-[11px] text-fg-subtle">
        Returns are computed from daily NAVs; CAGR for ≥3y windows uses{" "}
        ((NAV_now / NAV_then)^(1/years) − 1). Sharpe assumes a 7% risk-free
        rate.
      </p>
    </section>
  );
}

function Detail({ term, detail }: { term: string; detail: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-fg-muted">
        {term}
      </dt>
      <dd className="mt-0.5 text-sm">{detail}</dd>
    </div>
  );
}

// ── Misc ────────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
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
    </div>
  );
}

function formatNavDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

