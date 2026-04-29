import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  CalendarClock,
  ChevronRight,
  Layers,
  Loader2,
  Search,
  Sparkles,
  Wallet2,
} from "lucide-react";
import {
  useMfCatalog,
  useMfCategories,
  type MfFund,
} from "@/hooks/useMfCatalog";
import { useDebounce } from "@/hooks/useDebounce";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useLivePrices } from "@/hooks/useLivePrices";
import { useHoldings, usePortfolios } from "@/hooks/usePortfolio";
import { useSips } from "@/hooks/useSips";
import { MfInvestDialog } from "@/components/MfInvestDialog";
import { cn, formatCurrency, toNum } from "@/lib/utils";

const ALL_CATEGORIES = "__all";

export function MutualFundsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCategory = searchParams.get("category") ?? ALL_CATEGORIES;
  const [category, setCategory] = useState<string>(initialCategory);
  const [rawQuery, setRawQuery] = useState("");
  const query = useDebounce(rawQuery, 250);

  // Keep the URL in sync with the active category — makes detail-page
  // "See all" deep-links work and lets users share filtered views.
  useEffect(() => {
    if (category === ALL_CATEGORIES) {
      if (searchParams.get("category")) {
        setSearchParams({}, { replace: true });
      }
    } else if (searchParams.get("category") !== category) {
      setSearchParams({ category }, { replace: true });
    }
    // searchParams reference changes every render, but reading from it is
    // safe; we only call setSearchParams when the value actually differs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const cats = useMfCategories();
  const catalog = useMfCatalog({
    category: category === ALL_CATEGORIES ? "" : category,
    q: query,
    limit: 30,
  });

  // Live NAVs from the WS stream override the snapshot returned in
  // /mf/catalog. The worker only polls held/SIP'd MFs by default, so most
  // catalog entries fall back to the embedded NAV — but as soon as a user
  // buys or starts a SIP, that fund's NAV updates here too.
  const { quotes } = useLivePrices();
  const fundsWithLiveNav = useMemo<MfFund[]>(() => {
    return catalog.funds.map((f) => {
      const live = quotes[f.ticker];
      if (!live) return f;
      return {
        ...f,
        nav: {
          value: live.price,
          changePct: live.changePct,
          asOf: live.updatedAt,
          stale: false,
        },
      };
    });
  }, [catalog.funds, quotes]);

  // Sentinel for infinite scroll. Triggers when within 300 px of the
  // bottom; disabled when there's nothing more to fetch or one is
  // already in flight.
  const sentinelRef = useInfiniteScroll(
    !!catalog.hasNextPage && !catalog.isFetchingNextPage,
    () => catalog.fetchNextPage(),
  );

  const [investing, setInvesting] = useState<MfFund | null>(null);
  const [investMode, setInvestMode] = useState<"lumpsum" | "sip">("lumpsum");

  // User-context: which catalog rows is the user already invested in?
  // Powers the "Owned" / "SIP" badge — a signal generic MF browsers don't have.
  const portfolios = usePortfolios();
  const portfolio = portfolios.data?.[0];
  const holdings = useHoldings(portfolio?.id);
  const sips = useSips();
  const userContext = useMemo(() => {
    const owned = new Map<string, number>();
    for (const h of holdings.data ?? []) {
      const q = toNum(h.quantity);
      if (q > 0) owned.set(h.ticker, q);
    }
    const sipMap = new Map<string, { amount: number; frequency: string }>();
    for (const s of sips.data ?? []) {
      if (s.status !== "active") continue;
      sipMap.set(s.ticker, {
        amount: toNum(s.amount),
        frequency: s.frequency,
      });
    }
    return { owned, sipMap };
  }, [holdings.data, sips.data]);

  const totalCount = cats.data?.reduce((s, c) => s + c.count, 0) ?? 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-fg-muted">
            AMFI · Direct Plan
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Mutual funds
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            Browse {totalCount.toLocaleString("en-IN")} schemes across
            categories. Buy lumpsum or start a SIP. NAVs from{" "}
            <span className="text-fg">api.mfapi.in</span>; live for funds
            you hold.
          </p>
        </div>
      </header>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
        <input
          type="search"
          className="input pl-10"
          placeholder="Search by fund name or AMC — e.g. Axis Bluechip, Parag Parikh, HDFC…"
          value={rawQuery}
          onChange={(e) => setRawQuery(e.target.value)}
        />
      </div>

      {/* Category chips */}
      <div className="flex flex-wrap gap-1.5">
        <CategoryChip
          active={category === ALL_CATEGORIES}
          label="All"
          count={totalCount}
          onClick={() => setCategory(ALL_CATEGORIES)}
        />
        {(cats.data ?? []).map((c) => (
          <CategoryChip
            key={c.category}
            active={category === c.category}
            label={c.category}
            count={c.count}
            onClick={() => setCategory(c.category)}
          />
        ))}
      </div>

      {/* Result count + state */}
      <div className="flex items-center justify-between text-xs text-fg-muted">
        <span>
          {catalog.isLoading
            ? "Loading…"
            : `Showing ${fundsWithLiveNav.length.toLocaleString("en-IN")}${
                catalog.total > fundsWithLiveNav.length
                  ? ` of ${catalog.total.toLocaleString("en-IN")}`
                  : ""
              } ${fundsWithLiveNav.length === 1 ? "fund" : "funds"}${
                query ? ` matching "${query}"` : ""
              }`}
        </span>
        {catalog.isFetching && !catalog.isFetchingNextPage && !catalog.isLoading && (
          <span className="text-fg-subtle">refreshing…</span>
        )}
      </div>

      {/* Fund grid */}
      {catalog.isLoading ? (
        <SkeletonGrid />
      ) : fundsWithLiveNav.length === 0 ? (
        <EmptyState query={query} category={category} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {fundsWithLiveNav.map((f, i) => (
              <FundCard
                key={f.ticker}
                fund={f}
                index={i}
                ownedUnits={userContext.owned.get(f.ticker)}
                activeSip={userContext.sipMap.get(f.ticker)}
                onLumpsum={() => {
                  setInvestMode("lumpsum");
                  setInvesting(f);
                }}
                onSip={() => {
                  setInvestMode("sip");
                  setInvesting(f);
                }}
              />
            ))}
          </div>

          {/* Infinite-scroll sentinel + loader */}
          {catalog.hasNextPage && (
            <div ref={sentinelRef} className="h-12" aria-hidden />
          )}
          {catalog.isFetchingNextPage && (
            <div className="flex items-center justify-center gap-2 py-3 text-xs text-fg-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading more funds…
            </div>
          )}
          {!catalog.hasNextPage && fundsWithLiveNav.length > 0 && (
            <div className="py-3 text-center text-[11px] text-fg-subtle">
              You've reached the end · {fundsWithLiveNav.length.toLocaleString("en-IN")} funds shown
            </div>
          )}
        </>
      )}

      <MfInvestDialog
        fund={investing}
        open={!!investing}
        onOpenChange={(v) => !v && setInvesting(null)}
        defaultMode={investMode}
      />
    </div>
  );
}

function CategoryChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-brand bg-brand/10 text-fg"
          : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
      )}
    >
      <span>{label}</span>
      <span className="num rounded-full bg-overlay/5 px-1.5 text-[10px]">
        {count.toLocaleString("en-IN")}
      </span>
    </button>
  );
}

function FundCard({
  fund,
  index,
  ownedUnits,
  activeSip,
  onLumpsum,
  onSip,
}: {
  fund: MfFund;
  index: number;
  ownedUnits?: number;
  activeSip?: { amount: number; frequency: string };
  onLumpsum: () => void;
  onSip: () => void;
}) {
  const nav = fund.nav ? toNum(fund.nav.value) : 0;
  const changePct = fund.nav?.changePct ? toNum(fund.nav.changePct) : null;
  const isOwned = (ownedUnits ?? 0) > 0;
  const hasSip = !!activeSip;

  return (
    <motion.article
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 12) * 0.02 }}
      className="card flex flex-col p-4"
    >
      {/* Header — clickable area opens detail page */}
      <Link
        to={`/funds/${fund.ticker}`}
        className="group flex items-start justify-between gap-3 -m-1 rounded-lg p-1 transition-colors hover:bg-overlay/[0.02]"
      >
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-fg-muted">
            {fund.amc}
          </div>
          <h3 className="mt-0.5 line-clamp-2 text-sm font-medium leading-tight group-hover:text-brand">
            {fund.name}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="chip text-[10px]">{fund.category}</span>
          <ChevronRight className="h-3.5 w-3.5 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </Link>

      {/* NAV */}
      <div className="mt-4 flex items-end justify-between border-t border-border/60 pt-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-fg-muted">
            NAV
          </div>
          {nav > 0 ? (
            <div className="num mt-0.5 text-lg font-semibold">
              {formatCurrency(nav)}
            </div>
          ) : (
            <div className="num mt-0.5 text-sm text-fg-subtle">—</div>
          )}
          {changePct !== null && (
            <div
              className={cn(
                "num text-[11px]",
                changePct >= 0 ? "pos" : "neg",
              )}
            >
              {changePct >= 0 ? "+" : ""}
              {changePct.toFixed(2)}% d
            </div>
          )}
        </div>
        <OwnershipBadge
          isOwned={isOwned}
          ownedUnits={ownedUnits}
          nav={nav}
          activeSip={activeSip}
          hasSip={hasSip}
        />
      </div>

      {/* Ownership progress bar — only when user holds units, shows day's
          P&L direction at a glance. Quietly absent for unowned funds. */}
      {isOwned && changePct !== null && (
        <div className="mt-2">
          <div
            className={cn(
              "h-0.5 w-full overflow-hidden rounded-full bg-overlay/5",
            )}
          >
            <div
              className={cn(
                "h-full",
                changePct >= 0 ? "bg-success/80" : "bg-danger/80",
              )}
              style={{
                width: `${Math.min(100, Math.abs(changePct) * 20)}%`,
                marginLeft: changePct < 0 ? "auto" : 0,
              }}
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onLumpsum}
          className="btn-outline text-xs"
        >
          <Wallet2 className="h-3.5 w-3.5" />
          Lumpsum
        </button>
        <button type="button" onClick={onSip} className="btn-primary text-xs">
          <CalendarClock className="h-3.5 w-3.5" />
          Start SIP
        </button>
      </div>
    </motion.article>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="card animate-pulse p-4">
          <div className="h-3 w-16 rounded bg-overlay/5" />
          <div className="mt-2 h-4 w-3/4 rounded bg-overlay/5" />
          <div className="mt-1 h-4 w-1/2 rounded bg-overlay/5" />
          <div className="mt-6 h-6 w-24 rounded bg-overlay/5" />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="h-7 rounded bg-overlay/5" />
            <div className="h-7 rounded bg-overlay/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Surfaces the user's relationship to this fund — the one signal a generic
 * MF browser can't show. We deliberately render nothing when neither
 * applies (rather than fabricate a star rating or fund score), keeping
 * the card honest and the visual hierarchy clean.
 */
function OwnershipBadge({
  isOwned,
  ownedUnits,
  nav,
  activeSip,
  hasSip,
}: {
  isOwned: boolean;
  ownedUnits?: number;
  nav: number;
  activeSip?: { amount: number; frequency: string };
  hasSip: boolean;
}) {
  if (isOwned && ownedUnits) {
    const value = ownedUnits * nav;
    return (
      <div className="text-right">
        <span className="chip border-brand/40 bg-brand/10 text-[10px] text-brand">
          <Wallet2 className="h-3 w-3" /> Owned
        </span>
        {value > 0 && (
          <div className="num mt-1 text-[11px] text-fg-muted">
            {formatCurrency(value)}
          </div>
        )}
        <div className="num text-[10px] text-fg-subtle">
          {ownedUnits.toFixed(2)} units
        </div>
      </div>
    );
  }
  if (hasSip && activeSip) {
    return (
      <div className="text-right">
        <span className="chip border-success/30 bg-success/10 text-[10px] text-success">
          <CalendarClock className="h-3 w-3" /> SIP active
        </span>
        <div className="num mt-1 text-[10px] text-fg-muted">
          {formatCurrency(activeSip.amount)} / {activeSip.frequency === "yearly" ? "yr" : "mo"}
        </div>
      </div>
    );
  }
  return null;
}

function EmptyState({ query, category }: { query: string; category: string }) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      <Layers className="h-10 w-10 text-fg-subtle" />
      <p className="mt-4 text-sm text-fg-muted">
        {query
          ? `No funds match "${query}"${category !== ALL_CATEGORIES ? ` in ${category}` : ""}.`
          : "No funds in this category yet — try All."}
      </p>
      <p className="mt-2 text-[11px] text-fg-subtle">
        <Sparkles className="-mt-0.5 mr-1 inline h-3 w-3" />
        The catalog is loaded from mfapi.in's directory; if it just started up
        give it a few seconds.
      </p>
    </div>
  );
}
