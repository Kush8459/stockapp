import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Plus, Star } from "lucide-react";
import {
  useAddToWatchlist,
  useCreateWatchlist,
  useRemoveFromWatchlist,
  useWatchlistMemberships,
  useWatchlists,
} from "@/hooks/useWatchlist";
import { useToast } from "@/components/Toaster";
import { cn } from "@/lib/utils";

interface Props {
  ticker: string;
  assetType?: string;
}

/**
 * Chip-shaped trigger on the stock-detail header. Click opens a
 * lightweight popover with a checkbox per watchlist + an inline
 * "create new list" input.
 */
export function WatchlistPopover({ ticker, assetType = "stock" }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { data: lists = [] } = useWatchlists();
  const { data: memberships = new Set<string>() } = useWatchlistMemberships(
    ticker,
    assetType,
  );
  const watchedAny = memberships.size > 0;

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={
          watchedAny
            ? `On ${memberships.size} list${memberships.size === 1 ? "" : "s"}`
            : "Add to a watchlist"
        }
        className={cn(
          "chip transition-colors",
          watchedAny
            ? "border-warn/40 bg-warn/10 text-warn"
            : "hover:border-warn/40 hover:text-warn",
        )}
      >
        <Star className={cn("h-3 w-3", watchedAny && "fill-current")} />
        {watchedAny
          ? memberships.size === 1
            ? "Watching"
            : `Watching · ${memberships.size}`
          : "Watch"}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-border bg-bg-card p-2 shadow-glow">
          <div className="px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
            Add {ticker} to…
          </div>

          {lists.length === 0 ? (
            <div className="px-3 py-3 text-xs text-fg-muted">
              No watchlists yet — create your first one below.
            </div>
          ) : (
            <ul className="max-h-60 overflow-y-auto py-1">
              {lists.map((wl) => (
                <ListRow
                  key={wl.id}
                  listId={wl.id}
                  listName={wl.name}
                  ticker={ticker}
                  assetType={assetType}
                  checked={memberships.has(wl.id)}
                />
              ))}
            </ul>
          )}

          <div className="my-1 border-t border-border/60" />
          <CreateInline ticker={ticker} assetType={assetType} />
        </div>
      )}
    </div>
  );
}

function ListRow({
  listId,
  listName,
  ticker,
  assetType,
  checked,
}: {
  listId: string;
  listName: string;
  ticker: string;
  assetType: string;
  checked: boolean;
}) {
  const add = useAddToWatchlist();
  const remove = useRemoveFromWatchlist();
  const { push } = useToast();
  const pending = add.isPending || remove.isPending;

  function toggle() {
    if (checked) {
      remove.mutate(
        { listId, ticker, assetType },
        {
          onSuccess: () =>
            push({ kind: "info", title: `Removed ${ticker} from ${listName}` }),
        },
      );
    } else {
      add.mutate(
        { listId, ticker, assetType },
        {
          onSuccess: () =>
            push({ kind: "success", title: `Added ${ticker} to ${listName}` }),
        },
      );
    }
  }

  return (
    <li>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={cn(
          "flex w-full items-center justify-between rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-overlay/[0.05] disabled:opacity-50",
          checked && "text-fg",
        )}
      >
        <span className="truncate">{listName}</span>
        <span
          className={cn(
            "flex h-4 w-4 items-center justify-center rounded border",
            checked ? "border-brand bg-brand/20 text-brand" : "border-border",
          )}
        >
          {checked && <Check className="h-3 w-3" />}
        </span>
      </button>
    </li>
  );
}

function CreateInline({
  ticker,
  assetType,
}: {
  ticker: string;
  assetType: string;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const create = useCreateWatchlist();
  const add = useAddToWatchlist();
  const { push } = useToast();

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const list = await create.mutateAsync(trimmed);
      await add.mutateAsync({ listId: list.id, ticker, assetType });
      push({
        kind: "success",
        title: `Created ${list.name}`,
        description: `${ticker} added.`,
      });
      setName("");
      setAdding(false);
    } catch (err) {
      push({ kind: "error", title: "Couldn't create list", description: String(err) });
    }
  }

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-overlay/[0.05] hover:text-fg"
      >
        <Plus className="h-3.5 w-3.5" />
        New watchlist
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1.5 px-2 py-1">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") {
            setName("");
            setAdding(false);
          }
        }}
        placeholder="List name"
        autoFocus
        className="input !py-1.5 text-sm"
      />
      <button
        type="button"
        onClick={submit}
        disabled={create.isPending || !name.trim()}
        className="btn-primary !px-2 !py-1.5 text-xs"
      >
        {create.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Add"}
      </button>
    </div>
  );
}
