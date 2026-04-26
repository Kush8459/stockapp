import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useSectorDetail } from "@/hooks/useSectors";
import { useLivePrices } from "@/hooks/useLivePrices";
import { cn, formatCurrency, toNum } from "@/lib/utils";

export function SectorDetailPage() {
  const { slug } = useParams();
  const { data, isLoading } = useSectorDetail(slug);
  const { quotes } = useLivePrices();

  if (isLoading || !data) {
    return (
      <div className="flex h-full items-center justify-center py-24 text-fg-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading sector…
      </div>
    );
  }

  const live = quotes[data.indexTicker];
  const indexPrice = toNum(live?.price ?? data.indexQuote?.price);
  const indexPct = toNum(live?.changePct ?? data.indexQuote?.changePct);
  const indexHas = indexPrice > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </Link>

      <motion.header
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex flex-wrap items-end justify-between gap-4"
      >
        <div>
          <div className="text-xs uppercase tracking-wider text-fg-muted">Sector</div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{data.name}</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {data.indexTicker} · {data.components.length} component
            {data.components.length === 1 ? "" : "s"} tracked
          </p>
        </div>
        <div className="text-right">
          <div className="label">Index level</div>
          <div className="num text-2xl font-semibold">
            {indexHas
              ? indexPrice.toLocaleString("en-IN", { maximumFractionDigits: 2 })
              : "—"}
          </div>
          <div
            className={cn(
              "num text-sm font-medium",
              !indexHas ? "text-fg-subtle" : indexPct >= 0 ? "pos" : "neg",
            )}
          >
            {indexHas ? `${indexPct >= 0 ? "+" : ""}${indexPct.toFixed(2)}%` : ""}
          </div>
        </div>
      </motion.header>

      <section className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="label">Heatmap</div>
            <div className="text-xs text-fg-muted">
              Component stocks coloured by day-change. Click any cell for the
              full chart and history.
            </div>
          </div>
        </div>

        {data.components.length === 0 ? (
          <div className="py-10 text-center text-sm text-fg-muted">
            No constituent stocks tracked yet for this sector. Add tickers in{" "}
            <code className="num text-xs">internal/sectors/data.go</code>.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {data.components.map((c, i) => {
              const liveQ = quotes[c.ticker];
              const price = toNum(liveQ?.price ?? c.quote?.price);
              const pct = toNum(liveQ?.changePct ?? c.quote?.changePct);
              const has = price > 0;
              return (
                <motion.div
                  key={c.ticker}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.18, delay: Math.min(i, 12) * 0.02 }}
                >
                  <Link
                    to={`/stock/${c.ticker}`}
                    className={cn(
                      "block rounded-xl border p-4 transition-all hover:scale-[1.02] hover:shadow-glow",
                      heatmapBg(pct, has),
                    )}
                  >
                    <div className="num font-medium">{c.ticker}</div>
                    <div className="num mt-1 text-xs text-fg-muted">
                      {has ? formatCurrency(price) : "—"}
                    </div>
                    <div
                      className={cn(
                        "num mt-2 text-sm font-semibold",
                        !has
                          ? "text-fg-subtle"
                          : pct >= 0
                            ? "text-success"
                            : "text-danger",
                      )}
                    >
                      {has ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : ""}
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        )}
      </section>

      <p className="text-[11px] text-fg-subtle">
        Heatmap intensity reflects day-change: deeper green = bigger gain,
        deeper red = bigger loss. Cells with no live data render in neutral.
      </p>
    </div>
  );
}

// heatmapBg picks a tile background based on day-change. Six bands keeps the
// gradient legible — users can read direction at a glance + magnitude with
// a slightly closer look.
function heatmapBg(pct: number, has: boolean): string {
  if (!has) return "border-border bg-bg-soft/40";
  if (pct >= 3) return "border-success/40 bg-success/25";
  if (pct >= 1) return "border-success/30 bg-success/15";
  if (pct > 0) return "border-success/20 bg-success/[0.07]";
  if (pct === 0) return "border-border bg-bg-soft/60";
  if (pct > -1) return "border-danger/20 bg-danger/[0.07]";
  if (pct > -3) return "border-danger/30 bg-danger/15";
  return "border-danger/40 bg-danger/25";
}
