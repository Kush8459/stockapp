import { motion } from "framer-motion";
import { Activity, Coins, DollarSign } from "lucide-react";
import { useFundamentals, type Fundamentals } from "@/hooks/useFundamentals";
import { cn, formatCompact, formatPercent } from "@/lib/utils";

interface Props {
  ticker: string;
  /** Current live price — used to anchor the 52-wk hi/lo bar. */
  currentPrice?: number;
}

/**
 * Pure metrics card — valuation, performance, income. Company description
 * + sector/industry now live in <AboutCard>. Financial trend lives in
 * <FinancialsCard>.
 */
export function FundamentalsCard({ ticker, currentPrice }: Props) {
  const { data, isLoading, isError } = useFundamentals(ticker);

  if (isLoading) {
    return (
      <section className="card p-5">
        <div className="label">Fundamentals</div>
        <div className="mt-3 text-sm text-fg-muted">Loading…</div>
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section className="card p-5">
        <div className="label">Fundamentals</div>
        <div className="mt-3 text-sm text-fg-muted">
          Couldn't fetch fundamentals for {ticker} (Yahoo doesn't always have
          coverage for indices/ETFs/illiquid tickers).
        </div>
      </section>
    );
  }

  const has = (v?: number) => typeof v === "number" && !Number.isNaN(v);
  const empty =
    !has(data.marketCap) &&
    !has(data.trailingPE) &&
    !has(data.fiftyTwoWeekHigh) &&
    !has(data.dividendYield);

  if (empty) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="card p-5"
    >
      <header className="mb-4">
        <div className="label">Fundamentals</div>
        <p className="mt-1 text-xs text-fg-muted">
          Live valuation + 52-week trading range. Source: Yahoo Finance.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <ValuationBlock f={data} />
        <PerformanceBlock f={data} currentPrice={currentPrice} />
        <IncomeBlock f={data} />
      </div>
    </motion.section>
  );
}

function ValuationBlock({ f }: { f: Fundamentals }) {
  return (
    <Section icon={<DollarSign className="h-3.5 w-3.5" />} title="Valuation">
      <Row
        label="Market cap"
        value={f.marketCap != null ? `${formatCompact(f.marketCap)}` : null}
      />
      <Row
        label="P/E (TTM)"
        value={f.trailingPE != null ? f.trailingPE.toFixed(2) : null}
      />
      <Row
        label="Forward P/E"
        value={f.forwardPE != null ? f.forwardPE.toFixed(2) : null}
      />
      <Row
        label="P/B"
        value={f.priceToBook != null ? f.priceToBook.toFixed(2) : null}
      />
      <Row
        label="EPS"
        value={f.eps != null ? `₹${f.eps.toFixed(2)}` : null}
      />
      <Row
        label="Enterprise value"
        value={f.enterpriseValue != null ? `${formatCompact(f.enterpriseValue)}` : null}
      />
    </Section>
  );
}

function PerformanceBlock({
  f,
  currentPrice,
}: {
  f: Fundamentals;
  currentPrice?: number;
}) {
  const lo = f.fiftyTwoWeekLow;
  const hi = f.fiftyTwoWeekHigh;
  const showRange =
    typeof lo === "number" &&
    typeof hi === "number" &&
    typeof currentPrice === "number" &&
    hi > lo;

  const pct = showRange ? ((currentPrice! - lo!) / (hi! - lo!)) * 100 : 0;

  return (
    <Section icon={<Activity className="h-3.5 w-3.5" />} title="Performance">
      {showRange && (
        <div className="mb-2">
          <div className="num flex justify-between text-[10px] text-fg-muted">
            <span>52w low ₹{lo!.toFixed(2)}</span>
            <span>52w high ₹{hi!.toFixed(2)}</span>
          </div>
          <div className="relative mt-1 h-1.5 rounded-full bg-bg-soft">
            <div
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-brand"
              style={{
                left: `${Math.max(0, Math.min(100, pct))}%`,
              }}
            />
          </div>
        </div>
      )}
      <Row
        label="Beta"
        value={f.beta != null ? f.beta.toFixed(2) : null}
      />
      <Row
        label="Avg volume"
        value={f.averageVolume != null ? formatCompact(f.averageVolume) : null}
      />
      <Row
        label="Profit margin"
        value={f.profitMargins != null ? formatPercent(f.profitMargins * 100) : null}
      />
      <Row
        label="ROE"
        value={f.returnOnEquity != null ? formatPercent(f.returnOnEquity * 100) : null}
      />
      <Row
        label="Debt/Equity"
        value={f.debtToEquity != null ? f.debtToEquity.toFixed(2) : null}
      />
    </Section>
  );
}

function IncomeBlock({ f }: { f: Fundamentals }) {
  const yieldPct = f.dividendYield != null ? f.dividendYield * 100 : null;
  return (
    <Section icon={<Coins className="h-3.5 w-3.5" />} title="Income / dividends">
      <Row
        label="Dividend yield"
        value={
          yieldPct != null ? (
            <span className={cn(yieldPct >= 4 && "text-success", "num font-medium")}>
              {yieldPct.toFixed(2)}%
            </span>
          ) : null
        }
      />
      <Row
        label="Annual dividend"
        value={f.dividendRate != null ? `₹${f.dividendRate.toFixed(2)}/sh` : null}
      />
      <Row
        label="Payout ratio"
        value={f.payoutRatio != null ? formatPercent(f.payoutRatio * 100) : null}
      />
      {yieldPct == null && (
        <p className="mt-1 text-[11px] text-fg-subtle">
          Yahoo doesn't list a dividend yield for this ticker — either it
          doesn't pay one or the data is missing.
        </p>
      )}
    </Section>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-fg-muted">
        {icon}
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  if (value == null || value === "" || value === "0" || value === "0.00") return null;
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-fg-muted">{label}</span>
      <span className="num font-medium">{value}</span>
    </div>
  );
}

