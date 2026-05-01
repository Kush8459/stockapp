import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowUpRight,
  Briefcase,
  ChevronRight,
  Layers,
  LineChart,
  Loader2,
  Search,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  useStocksCatalog,
  useStocksCategories,
  type CategoryGroup,
  type StockCard,
} from "@/hooks/useStocksCatalog";
import { useDebounce } from "@/hooks/useDebounce";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useLivePrices, type Quote } from "@/hooks/useLivePrices";
import { useMarketStatus } from "@/hooks/useMarketStatus";
import { LiveBadge } from "@/components/LiveBadge";
import { cn, formatCurrency, formatPercent, toNum } from "@/lib/utils";

/**
 * Stock browse page — the equity equivalent of /funds. Three category
 * groups (Movers, Indices, Sectors) are loaded from /stocks/categories.
 * The card grid responds to live WebSocket ticks: every price update
 * flashes a short border highlight on the corresponding card so the
 * "this is real-time" affordance is visible without polling animations.
 *
 * Default state lands on Top Gainers so users see live action immediately
 * instead of an empty grid; they can clear the chip or pick another to
 * browse a different slice of the universe.
 */
export function StocksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCategory = searchParams.get("category") ?? "movers:gainers";
  const [category, setCategory] = useState<string>(initialCategory);
  const [rawQuery, setRawQuery] = useState("");
  const query = useDebounce(rawQuery, 250);

  // Mirror the URL so deep-links + back-forward navigation work like the
  // funds page does. Empty category drops the param entirely.
  useEffect(() => {
    if (!category) {
      if (searchParams.get("category")) setSearchParams({}, { replace: true });
    } else if (searchParams.get("category") !== category) {
      setSearchParams({ category }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const cats = useStocksCategories();
  const catalog = useStocksCatalog({ category, q: query, limit: 60 });
  const { quotes, connected } = useLivePrices();
  // One subscriber for the page; passed to each card via prop so we
  // don't have 60 separate market-status query subscriptions running.
  const { data: market } = useMarketStatus();
  const marketOpen = market?.status === "open" || market?.status === "preopen";

  // Live-tick override — same trick the MF page uses. The catalog
  // endpoint returns a snapshot quote per card; the WebSocket stream
  // overrides with whatever the worker last pushed.
  const cards = useMemo<StockCard[]>(() => {
    return catalog.stocks.map((c) => {
      const live = quotes[c.ticker];
      if (!live) return c;
      return { ...c, quote: live };
    });
  }, [catalog.stocks, quotes]);

  // Infinite-scroll sentinel — auto-loads the next page when within 300px
  // of the bottom; suspended while a fetch is in flight or the list is done.
  const sentinelRef = useInfiniteScroll(
    !!catalog.hasNextPage && !catalog.isFetchingNextPage,
    () => catalog.fetchNextPage(),
  );

  // "Market mood" — derived from visible cards. Shifts as tickers move
  // because `cards` re-evaluates whenever quotes change.
  const mood = useMemo(() => {
    let advancing = 0;
    let declining = 0;
    let unchanged = 0;
    let sum = 0;
    let count = 0;
    for (const c of cards) {
      const ch = toNum(c.quote?.changePct);
      if (!c.quote) {
        unchanged++;
        continue;
      }
      if (ch > 0) advancing++;
      else if (ch < 0) declining++;
      else unchanged++;
      sum += ch;
      count++;
    }
    return {
      advancing,
      declining,
      unchanged,
      avg: count > 0 ? sum / count : 0,
    };
  }, [cards]);

  const activeGroup = findGroupContaining(cats.data, category);
  const activeLabel = activeGroup?.items.find((i) => i.id === category)?.label;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-fg-muted">
            <span>NSE</span>
            <LiveBadge connected={connected} />
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Stocks</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Browse by movers, index membership, or sector. Prices stream in
            real-time during market hours; outside hours, cards show the
            last known close.
          </p>
        </div>

        <MarketMood mood={mood} />
      </header>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
        <input
          type="search"
          className="input pl-10"
          placeholder="Search by symbol or company — e.g. RELIANCE, Infosys, HDFC…"
          value={rawQuery}
          onChange={(e) => setRawQuery(e.target.value)}
        />
      </div>

      {/* Group + chips */}
      <CategoryStrip
        groups={cats.data ?? []}
        category={category}
        onCategory={setCategory}
      />

      {/* Result info row */}
      <div className="flex items-center justify-between text-xs text-fg-muted">
        <span>
          {catalog.isLoading
            ? "Loading…"
            : !category && !query
              ? "Type to search any NSE stock, or pick a filter above."
              : `Showing ${cards.length.toLocaleString("en-IN")}${
                  catalog.total > cards.length
                    ? ` of ${catalog.total.toLocaleString("en-IN")}`
                    : ""
                } ${cards.length === 1 ? "stock" : "stocks"}${
                  activeLabel ? ` in ${activeLabel}` : ""
                }${query ? ` matching "${query}"` : ""}`}
        </span>
        <div className="flex items-center gap-3">
          {category && (
            <button
              type="button"
              onClick={() => setCategory("")}
              className="text-fg-subtle hover:text-fg"
            >
              Clear filter
            </button>
          )}
          {catalog.isFetching &&
            !catalog.isFetchingNextPage &&
            !catalog.isLoading && (
              <span className="text-fg-subtle">refreshing…</span>
            )}
        </div>
      </div>

      {/* Grid — wrapped in AnimatePresence so category transitions stagger */}
      <AnimatePresence mode="wait">
        <motion.div
          key={category + query}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
        >
          {catalog.isLoading ? (
            <SkeletonGrid />
          ) : cards.length === 0 ? (
            !category && !query ? (
              <BlankSlate />
            ) : (
              <EmptyState query={query} />
            )
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {cards.map((c, i) => (
                  <Card
                    key={c.ticker}
                    card={c}
                    index={i}
                    marketOpen={marketOpen}
                    marketLabel={market?.label}
                  />
                ))}
              </div>

              {/* Infinite-scroll sentinel + footer */}
              {catalog.hasNextPage && (
                <div ref={sentinelRef} className="h-12" aria-hidden />
              )}
              {catalog.isFetchingNextPage && (
                <div className="flex items-center justify-center gap-2 py-3 text-xs text-fg-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading more stocks…
                </div>
              )}
              {!catalog.hasNextPage && cards.length > 0 && (
                <div className="py-3 text-center text-[11px] text-fg-subtle">
                  You've reached the end · {cards.length.toLocaleString("en-IN")} stocks shown
                </div>
              )}
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ── Category strip ──────────────────────────────────────────────────────

function CategoryStrip({
  groups,
  category,
  onCategory,
}: {
  groups: CategoryGroup[];
  category: string;
  onCategory: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.name}>
          <div className="mb-1.5 flex items-center gap-2 text-[11px] uppercase tracking-wider text-fg-subtle">
            <GroupIcon name={g.name} />
            <span>{g.name}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {g.items.map((it) => (
              <Chip
                key={it.id}
                active={category === it.id}
                label={it.label}
                count={it.count}
                onClick={() => onCategory(it.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function GroupIcon({ name }: { name: string }) {
  if (name === "Movers") return <TrendingUp className="h-3 w-3" />;
  if (name === "Indices") return <LineChart className="h-3 w-3" />;
  if (name === "Sectors") return <Layers className="h-3 w-3" />;
  return <Briefcase className="h-3 w-3" />;
}

function Chip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      className={cn(
        "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-brand bg-brand/10 text-fg"
          : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
      )}
    >
      <span>{label}</span>
      {count !== undefined && count > 0 && (
        <span className="num rounded-full bg-overlay/5 px-1.5 text-[10px]">
          {count.toLocaleString("en-IN")}
        </span>
      )}
    </motion.button>
  );
}

// ── Stock card with live tick flash ─────────────────────────────────────

function Card({
  card,
  index,
  marketOpen,
  marketLabel,
}: {
  card: StockCard;
  index: number;
  marketOpen: boolean;
  marketLabel?: string;
}) {
  const live = card.quote;
  const price = toNum(live?.price);
  const changePct = toNum(live?.changePct);
  const positive = changePct >= 0;

  // Flash border briefly whenever the price actually changes — visible
  // confirmation that the data is streaming, no polling animation needed.
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prevPriceRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!live) return;
    const newPrice = toNum(live.price);
    const prev = prevPriceRef.current;
    if (prev !== undefined && newPrice !== prev && newPrice > 0) {
      setFlash(newPrice > prev ? "up" : "down");
      const t = window.setTimeout(() => setFlash(null), 600);
      prevPriceRef.current = newPrice;
      return () => window.clearTimeout(t);
    }
    prevPriceRef.current = newPrice;
  }, [live?.price]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 24) * 0.015, duration: 0.22 }}
      whileHover={{ y: -2 }}
      className={cn(
        "relative",
        flash === "up" && "ring-1 ring-success/40",
        flash === "down" && "ring-1 ring-danger/40",
        flash !== null && "transition-shadow duration-300",
      )}
    >
      <Link
        to={`/stock/${card.ticker}`}
        className="card group flex flex-col p-4 transition-colors hover:border-border-strong"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold",
                  iconColor(card.ticker),
                )}
              >
                {card.ticker.slice(0, 2)}
              </span>
              <span className="num truncate text-base font-semibold leading-tight group-hover:text-brand">
                {card.ticker}
              </span>
            </div>
            {card.name && (
              <div className="mt-1 line-clamp-1 text-[11px] text-fg-muted">
                {card.name}
              </div>
            )}
          </div>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />
        </div>

        {/* Price + day change */}
        <div className="mt-4 flex items-end justify-between border-t border-border/60 pt-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-fg-muted">
              Price
            </div>
            <div className="num mt-0.5 text-lg font-semibold">
              {price > 0 ? formatCurrency(price) : "—"}
            </div>
          </div>
          {live ? (
            <ChangeBadge changePct={changePct} positive={positive} />
          ) : (
            <span className="num text-[10px] text-fg-subtle">no quote</span>
          )}
        </div>

        {/* Tick freshness footer */}
        {live && (
          <TickStamp
            quote={live}
            marketOpen={marketOpen}
            marketLabel={marketLabel}
          />
        )}
      </Link>
    </motion.div>
  );
}

function ChangeBadge({
  changePct,
  positive,
}: {
  changePct: number;
  positive: boolean;
}) {
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return (
    <div
      className={cn(
        "num flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
        positive
          ? "bg-success/10 text-success"
          : "bg-danger/10 text-danger",
      )}
    >
      <Icon className="h-3 w-3" />
      {formatPercent(changePct)}
    </div>
  );
}

/**
 * Per-card freshness footer. The label is market-aware so it never
 * pretends the price is "live" when the exchange is shut.
 *
 * When the market is OPEN (or pre-open):
 *   • <30s   → green pulsing dot, "live"
 *   • <5min  → dim green dot, "30s ago"
 *   • else   → grey dot, plain relative time (the worker should be
 *              ticking — anything stale during market hours is a
 *              "something's stuck" signal worth seeing)
 *
 * When the market is CLOSED / weekend / holiday:
 *   • Always grey dot, label "Closed" plus the market's own status
 *     phrase ("Closed · Holiday: Republic Day", "Closed · Weekend",
 *     etc.). Quote age isn't useful here — exchanges don't tick
 *     overnight; the price IS the previous close.
 */
function TickStamp({
  quote,
  marketOpen,
  marketLabel,
}: {
  quote: Quote;
  marketOpen: boolean;
  marketLabel?: string;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 5000);
    return () => window.clearInterval(id);
  }, []);
  void tick;

  if (!marketOpen) {
    return (
      <div className="num mt-3 flex items-center gap-1.5 text-[10px] text-fg-subtle">
        <span className="h-1.5 w-1.5 rounded-full bg-fg-subtle/60" />
        Closed{marketLabel ? ` · ${marketLabel}` : ""}
      </div>
    );
  }

  const updated = new Date(quote.updatedAt);
  const ageSec = Math.floor((Date.now() - updated.getTime()) / 1000);
  const isFresh = ageSec >= 0 && ageSec < 30;
  const isRecent = ageSec < 300;

  return (
    <div className="num mt-3 flex items-center gap-1.5 text-[10px] text-fg-subtle">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          isFresh
            ? "bg-success animate-pulse"
            : isRecent
              ? "bg-success/50"
              : "bg-fg-subtle/60",
        )}
      />
      {isFresh ? "live" : relativeAgo(updated)}
    </div>
  );
}

// ── Market mood pill ────────────────────────────────────────────────────

function MarketMood({
  mood,
}: {
  mood: { advancing: number; declining: number; unchanged: number; avg: number };
}) {
  const total = mood.advancing + mood.declining + mood.unchanged;
  if (total === 0) return null;
  const advPct = (mood.advancing / total) * 100;
  const decPct = (mood.declining / total) * 100;
  const positive = mood.avg >= 0;

  return (
    <div className="card flex items-center gap-3 px-4 py-2.5">
      <div className="flex flex-col items-end leading-tight">
        <div className="text-[10px] uppercase tracking-wider text-fg-muted">
          Market mood
        </div>
        <div
          className={cn(
            "num text-sm font-semibold",
            positive ? "pos" : "neg",
          )}
        >
          {positive ? "+" : ""}
          {mood.avg.toFixed(2)}% avg
        </div>
      </div>
      {/* Stacked bar showing advancing vs declining proportion */}
      <div className="flex h-7 w-32 overflow-hidden rounded-full bg-bg-soft">
        <div
          className="h-full bg-success/70 transition-all duration-500"
          style={{ width: `${advPct}%` }}
          title={`${mood.advancing} advancing`}
        />
        <div
          className="h-full bg-danger/70 transition-all duration-500"
          style={{ width: `${decPct}%` }}
          title={`${mood.declining} declining`}
        />
      </div>
      <div className="num flex flex-col items-start text-[10px] leading-tight">
        <span className="pos">▲ {mood.advancing}</span>
        <span className="neg">▼ {mood.declining}</span>
      </div>
    </div>
  );
}

// ── Skeleton + empty ────────────────────────────────────────────────────

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="card animate-pulse p-4">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded bg-overlay/5" />
            <div className="h-4 w-24 rounded bg-overlay/5" />
          </div>
          <div className="mt-2 h-3 w-3/4 rounded bg-overlay/5" />
          <div className="mt-6 flex items-end justify-between">
            <div className="h-6 w-20 rounded bg-overlay/5" />
            <div className="h-5 w-14 rounded-full bg-overlay/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      <TrendingDown className="h-10 w-10 text-fg-subtle" />
      <p className="mt-4 text-sm text-fg-muted">
        {query
          ? `No stocks match "${query}" in this category.`
          : "No quotes available yet — the price worker may still be warming up."}
      </p>
    </div>
  );
}

function BlankSlate() {
  return (
    <div className="card flex flex-col items-center px-6 py-16 text-center">
      <Search className="h-10 w-10 text-fg-subtle" />
      <p className="mt-4 text-sm text-fg-muted">
        Search any NSE stock by symbol or company name, or pick a filter
        above to browse a curated set.
      </p>
      <p className="mt-2 text-[11px] text-fg-subtle">
        Try <span className="text-fg">RELIANCE</span>,{" "}
        <span className="text-fg">Infosys</span>, or{" "}
        <span className="text-fg">HDFC</span> to get started.
      </p>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

function findGroupContaining(
  groups: CategoryGroup[] | undefined,
  id: string,
): CategoryGroup | undefined {
  if (!groups) return undefined;
  return groups.find((g) => g.items.some((i) => i.id === id));
}

function relativeAgo(d: Date): string {
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function iconColor(ticker: string): string {
  // Stable hue per ticker so cards keep the same accent across renders.
  // Six muted accents — enough variety, none competing with the brand.
  const palette = [
    "bg-cyan-500/15 text-cyan-300",
    "bg-violet-500/15 text-violet-300",
    "bg-emerald-500/15 text-emerald-300",
    "bg-amber-500/15 text-amber-300",
    "bg-fuchsia-500/15 text-fuchsia-300",
    "bg-sky-500/15 text-sky-300",
  ];
  let h = 0;
  for (let i = 0; i < ticker.length; i++) h = (h * 31 + ticker.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
