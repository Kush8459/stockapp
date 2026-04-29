import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Loader2, Search } from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce";
import { useSearch, type SearchResult } from "@/hooks/useSearch";
import { cn } from "@/lib/utils";

interface TickerSearchPickerProps {
  /** The bare ticker (no ".NS" suffix). */
  value: string;
  onChange: (ticker: string) => void;
  /**
   * Called when the user actually picks a result so the parent can stash
   * the human-readable name. Optional — `onChange` is enough for the
   * minimum case.
   */
  onPick?: (r: { ticker: string; name: string; type: string }) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Optional cached display name to show under the input for the current
   *  value before the user opens the picker again. */
  selectedName?: string;
}

/**
 * Searchable ticker autocomplete. Hits the same /search endpoint the
 * dashboard's global search bar uses — no hardcoded universe.
 *
 * Behaviour:
 *  - User types → debounced API call (≥2 chars).
 *  - Up/Down arrows move highlight, Enter picks, Esc closes.
 *  - Clicking outside closes. Blur from tab key keeps the value as-typed
 *    so SIP forms can still validate at submit time.
 */
export function TickerSearchPicker({
  value,
  onChange,
  onPick,
  placeholder = "Search any Indian stock or fund…",
  disabled,
  selectedName,
}: TickerSearchPickerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  // The input shows whatever the user is typing; once they pick a result
  // we sync `query` back to the canonical ticker.
  useEffect(() => {
    if (value !== query.toUpperCase()) {
      setQuery(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const debounced = useDebounce(query, 250);
  const { data: results = [], isFetching } = useSearch(debounced);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => setActiveIdx(0), [debounced]);

  function pick(r: SearchResult) {
    const t = stripSuffix(r.symbol);
    onChange(t);
    onPick?.({ ticker: t, name: r.name, type: r.type });
    setQuery(t);
    setOpen(false);
  }

  const showDropdown = open && debounced.trim().length >= 2;
  const display = useMemo(() => {
    if (selectedName && value && query === value) return selectedName;
    return null;
  }, [selectedName, value, query]);

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
        <input
          type="text"
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value.toUpperCase());
            // Don't immediately commit to `value`; only commit on pick.
            // But also keep the parent in sync so submit-without-pick still
            // works for users who type a ticker exactly.
            onChange(e.target.value.toUpperCase());
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!showDropdown) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIdx((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && results[activeIdx]) {
              e.preventDefault();
              pick(results[activeIdx]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className="input w-full pl-9 pr-10 uppercase"
          aria-autocomplete="list"
          aria-expanded={open}
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
          {isFetching && debounced.length >= 2 && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-subtle" />
          )}
          <button
            type="button"
            aria-label="Toggle suggestions"
            onClick={() => setOpen((o) => !o)}
            className="rounded p-1 text-fg-subtle hover:bg-overlay/5 hover:text-fg"
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          </button>
        </div>
      </div>

      {display && !showDropdown && (
        <div className="mt-1 truncate text-[11px] text-fg-subtle">
          {display}
        </div>
      )}

      {showDropdown && (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-bg-elevated shadow-card">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-fg-muted">
              {isFetching ? "Searching…" : `No matches for "${debounced}".`}
            </div>
          ) : (
            <ul role="listbox">
              {results.map((r, i) => (
                <li
                  key={r.symbol}
                  role="option"
                  aria-selected={i === activeIdx}
                  onMouseEnter={() => setActiveIdx(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(r);
                  }}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 border-b border-border/40 px-4 py-2.5 last:border-0",
                    i === activeIdx && "bg-overlay/[0.05]",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold",
                      colorForType(r.type),
                    )}
                  >
                    {stripSuffix(r.symbol).slice(0, 2)}
                  </span>
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="num flex items-center gap-2 truncate text-sm font-medium">
                      <span>{stripSuffix(r.symbol)}</span>
                      <span className="text-[10px] font-normal uppercase text-fg-subtle">
                        {r.type === "EQUITY" ? "stock" : r.type.toLowerCase()}
                      </span>
                    </div>
                    <div className="truncate text-xs text-fg-muted">{r.name}</div>
                  </div>
                  {r.exchange && (
                    <span className="num shrink-0 rounded-full border border-border bg-bg-soft px-2 py-0.5 text-[10px] text-fg-muted">
                      {r.exchange}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function stripSuffix(symbol: string): string {
  return symbol.replace(/\.(NS|BO)$/i, "");
}

function colorForType(type: string): string {
  switch (type) {
    case "MUTUALFUND":
      return "bg-violet-500/15 text-violet-300";
    case "ETF":
      return "bg-emerald-500/15 text-emerald-300";
    case "INDEX":
      return "bg-sky-500/15 text-sky-300";
    case "EQUITY":
    default:
      return "bg-cyan-500/15 text-cyan-300";
  }
}
