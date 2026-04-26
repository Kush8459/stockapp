import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  ChevronRight,
  Eye,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  useCreateWatchlist,
  useDeleteWatchlist,
  useRemoveFromWatchlist,
  useRenameWatchlist,
  useWatchlists,
  useWatchlistItems,
  type Watchlist,
  type WatchlistItem,
} from "@/hooks/useWatchlist";
import { useLivePrices } from "@/hooks/useLivePrices";
import { usePortfolios } from "@/hooks/usePortfolio";
import { TradeDialog } from "@/components/TradeDialog";
import { AlertForm } from "@/components/AlertForm";
import { LiveBadge } from "@/components/LiveBadge";
import { useToast } from "@/components/Toaster";
import { cn, formatCurrency, formatPercent, toNum } from "@/lib/utils";

export function WatchlistPage() {
  const navigate = useNavigate();
  const { connected } = useLivePrices();
  const { data: lists = [], isLoading: listsLoading } = useWatchlists();
  const [activeID, setActiveID] = useState<string | null>(null);

  // Auto-pick the first list once lists load.
  useEffect(() => {
    if (!activeID && lists.length > 0) setActiveID(lists[0].id);
    // If the active list got deleted elsewhere, fall back to the first.
    if (activeID && !lists.find((l) => l.id === activeID) && lists.length > 0) {
      setActiveID(lists[0].id);
    }
  }, [lists, activeID]);

  if (listsLoading) {
    return (
      <div className="flex h-full items-center justify-center py-24 text-fg-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading watchlists…
      </div>
    );
  }

  const active = lists.find((l) => l.id === activeID);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-fg-muted">Tracking</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Watchlists</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Organize tickers into lists. Star any stock from its detail page.
          </p>
        </div>
        <LiveBadge connected={connected} />
      </header>

      <ListTabs lists={lists} activeID={activeID} onSelect={setActiveID} />

      {active ? (
        <ItemsTable list={active} navigate={navigate} />
      ) : (
        <EmptyAccount />
      )}
    </div>
  );
}

// ── Tabs ────────────────────────────────────────────────────────────────

function ListTabs({
  lists,
  activeID,
  onSelect,
}: {
  lists: Watchlist[];
  activeID: string | null;
  onSelect: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const create = useCreateWatchlist();
  const { push } = useToast();

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const wl = await create.mutateAsync(trimmed);
      push({ kind: "success", title: `Created ${wl.name}` });
      setName("");
      setCreating(false);
      onSelect(wl.id);
    } catch (e) {
      push({ kind: "error", title: "Couldn't create list", description: String(e) });
    }
  }

  return (
    <div className="card flex flex-wrap items-center gap-1 p-1">
      {lists.map((wl) => (
        <TabPill
          key={wl.id}
          list={wl}
          active={wl.id === activeID}
          onSelect={() => onSelect(wl.id)}
        />
      ))}

      {creating ? (
        <div className="ml-1 flex items-center gap-1">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") {
                setName("");
                setCreating(false);
              }
            }}
            placeholder="List name"
            autoFocus
            className="input !py-1.5 !pl-2 !pr-2 text-sm w-40"
          />
          <button
            type="button"
            onClick={submit}
            disabled={create.isPending || !name.trim()}
            className="btn-primary !px-2 !py-1.5 text-xs"
          >
            {create.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Add"}
          </button>
          <button
            type="button"
            onClick={() => {
              setName("");
              setCreating(false);
            }}
            className="rounded-md p-1.5 text-fg-muted hover:bg-white/5 hover:text-fg"
            aria-label="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="ml-1 flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-white/5 hover:text-fg"
        >
          <Plus className="h-3.5 w-3.5" /> New list
        </button>
      )}
    </div>
  );
}

function TabPill({
  list,
  active,
  onSelect,
}: {
  list: Watchlist;
  active: boolean;
  onSelect: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(list.name);
  const rename = useRenameWatchlist();
  const remove = useDeleteWatchlist();
  const { push } = useToast();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => setName(list.name), [list.name]);

  // Close kebab menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  async function submitRename() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === list.name) {
      setRenaming(false);
      return;
    }
    try {
      await rename.mutateAsync({ id: list.id, name: trimmed });
      push({ kind: "info", title: `Renamed to ${trimmed}` });
    } catch (e) {
      push({ kind: "error", title: "Couldn't rename", description: String(e) });
    }
    setRenaming(false);
  }

  function confirmDelete() {
    if (!confirm(`Delete "${list.name}"? This removes all ${list.itemCount} ticker(s).`)) {
      return;
    }
    remove.mutate(list.id, {
      onSuccess: () => push({ kind: "info", title: `Deleted ${list.name}` }),
    });
    setMenuOpen(false);
  }

  if (renaming) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitRename();
            if (e.key === "Escape") {
              setName(list.name);
              setRenaming(false);
            }
          }}
          autoFocus
          className="input !py-1.5 !pl-2 !pr-2 text-sm w-40"
        />
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
          active ? "bg-white/10 text-fg" : "text-fg-muted hover:bg-white/5 hover:text-fg",
        )}
      >
        <span>{list.name}</span>
        <span className="num rounded-full bg-white/5 px-1.5 text-[10px] text-fg-muted">
          {list.itemCount}
        </span>
        <span
          role="button"
          tabIndex={0}
          aria-label="List menu"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }
          }}
          className="ml-0.5 rounded p-0.5 text-fg-subtle hover:bg-white/5 hover:text-fg"
        >
          <MoreVertical className="h-3 w-3" />
        </span>
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-full z-40 mt-1 w-36 rounded-lg border border-border bg-bg-card p-1 shadow-glow">
          <button
            type="button"
            onClick={() => {
              setRenaming(true);
              setMenuOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-fg-muted hover:bg-white/5 hover:text-fg"
          >
            <Pencil className="h-3 w-3" /> Rename
          </button>
          <button
            type="button"
            onClick={confirmDelete}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-fg-muted hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ── Items table ─────────────────────────────────────────────────────────

interface EnrichedRow extends WatchlistItem {
  livePrice: number;
  livePct: number;
}

function ItemsTable({
  list,
  navigate,
}: {
  list: Watchlist;
  navigate: (path: string) => void;
}) {
  const { data: items = [], isLoading } = useWatchlistItems(list.id);
  const { quotes } = useLivePrices();
  const portfolios = usePortfolios();
  const portfolio = portfolios.data?.[0];
  const remove = useRemoveFromWatchlist();
  const { push } = useToast();

  const [trade, setTrade] = useState<null | {
    ticker: string;
    side: "buy" | "sell";
    assetType: "stock" | "mf";
  }>(null);
  const [alertFor, setAlertFor] = useState<string | null>(null);

  const rows: EnrichedRow[] = useMemo(() => {
    return items.map((it) => {
      const live = quotes[it.ticker] ?? it.quote;
      return {
        ...it,
        livePrice: toNum(live?.price),
        livePct: toNum(live?.changePct),
      };
    });
  }, [items, quotes]);

  if (isLoading) {
    return (
      <div className="card py-10 text-center text-sm text-fg-muted">
        <Loader2 className="mx-auto h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="card flex flex-col items-center justify-center gap-3 p-14 text-center">
        <Eye className="h-7 w-7 text-fg-subtle" />
        <p className="max-w-md text-sm text-fg-muted">
          <strong>{list.name}</strong> is empty. Find any NSE stock with the search
          bar at the top, open its detail page, and click{" "}
          <span className="inline-flex items-center gap-1 text-fg">
            <Star className="h-3 w-3" /> Watch
          </span>{" "}
          to add it here.
        </p>
      </div>
    );
  }

  return (
    <>
      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/80 text-[11px] uppercase tracking-wider text-fg-muted">
                <th className="px-4 py-3 text-left font-medium">Ticker</th>
                <th className="px-4 py-3 text-right font-medium">Price</th>
                <th className="px-4 py-3 text-right font-medium">Day change</th>
                <th className="px-4 py-3 text-right font-medium">Added</th>
                <th className="w-44 px-4 py-3 text-right font-medium">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <Row
                  key={r.id}
                  r={r}
                  index={i}
                  onOpen={() => navigate(`/stock/${r.ticker}`)}
                  onBuy={() =>
                    setTrade({
                      ticker: r.ticker,
                      side: "buy",
                      assetType: r.assetType,
                    })
                  }
                  onSell={() =>
                    setTrade({
                      ticker: r.ticker,
                      side: "sell",
                      assetType: r.assetType,
                    })
                  }
                  onAlert={() => setAlertFor(r.ticker)}
                  onRemove={() =>
                    remove.mutate(
                      {
                        listId: list.id,
                        ticker: r.ticker,
                        assetType: r.assetType,
                      },
                      {
                        onSuccess: () =>
                          push({
                            kind: "info",
                            title: `${r.ticker} removed from ${list.name}`,
                          }),
                      },
                    )
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {trade && portfolio && (
        <TradeDialog
          open
          onOpenChange={(v) => !v && setTrade(null)}
          portfolioId={portfolio.id}
          ticker={trade.ticker}
          side={trade.side}
          assetType={trade.assetType}
          livePrice={toNum(quotes[trade.ticker]?.price)}
        />
      )}

      <AlertForm
        open={!!alertFor}
        onOpenChange={(v) => !v && setAlertFor(null)}
        defaultTicker={alertFor ?? undefined}
        currentPrice={alertFor ? toNum(quotes[alertFor]?.price) : undefined}
      />
    </>
  );
}

function Row({
  r,
  index,
  onOpen,
  onBuy,
  onSell,
  onAlert,
  onRemove,
}: {
  r: EnrichedRow;
  index: number;
  onOpen: () => void;
  onBuy: () => void;
  onSell: () => void;
  onAlert: () => void;
  onRemove: () => void;
}) {
  const has = r.livePrice > 0;
  return (
    <motion.tr
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 12) * 0.02 }}
      onClick={onOpen}
      className="group cursor-pointer border-b border-border/40 align-middle transition-colors last:border-0 hover:bg-white/[0.03]"
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold",
              r.assetType === "mf"
                ? "bg-violet-500/15 text-violet-300"
                : "bg-cyan-500/15 text-cyan-300",
            )}
          >
            {r.ticker.slice(0, 2)}
          </span>
          <div className="leading-tight">
            <div className="font-medium group-hover:text-brand">{r.ticker}</div>
            <div className="text-[10px] uppercase text-fg-muted">{r.assetType}</div>
          </div>
        </div>
      </td>
      <td className="num px-4 py-3 text-right font-medium">
        {has ? formatCurrency(r.livePrice) : "—"}
      </td>
      <td className="px-4 py-3 text-right">
        <span
          className={cn(
            "num text-sm font-medium",
            !has ? "text-fg-subtle" : r.livePct >= 0 ? "pos" : "neg",
          )}
        >
          {has ? formatPercent(r.livePct) : ""}
        </span>
      </td>
      <td className="num px-4 py-3 text-right text-[11px] text-fg-subtle">
        {new Date(r.createdAt).toLocaleDateString(undefined, {
          day: "2-digit",
          month: "short",
        })}
      </td>
      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
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
          <IconBtn onClick={onRemove} label="Remove from this list" tone="danger">
            <Trash2 className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn onClick={onOpen} label="Open detail">
            <ChevronRight className="h-3.5 w-3.5" />
          </IconBtn>
        </div>
      </td>
    </motion.tr>
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
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-white/5",
        tone === "success" && "hover:text-success",
        tone === "danger" && "hover:text-danger",
        !tone && "hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function EmptyAccount() {
  return (
    <div className="card flex flex-col items-center justify-center gap-3 p-14 text-center">
      <Eye className="h-7 w-7 text-fg-subtle" />
      <p className="max-w-md text-sm text-fg-muted">
        Create your first watchlist with the <strong>+ New list</strong> button
        above, then star any stock from its detail page to add it.
      </p>
    </div>
  );
}
