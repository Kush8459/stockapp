import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Search as SearchIcon, X } from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce";
import { useSearch, type SearchResult } from "@/hooks/useSearch";
import { cn } from "@/lib/utils";

/**
 * Global ticker search. Debounces the input, hits /api/v1/search, renders
 * matches in a floating dropdown. Keyboard: ↑/↓ to move, Enter to pick,
 * Esc to close. Cmd/Ctrl+K opens it from anywhere.
 */
export function SearchBar() {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const debounced = useDebounce(query, 300);
  const { data: results = [], isFetching } = useSearch(debounced);

  // Cmd/Ctrl+K to focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    setOpen(false);
    setQuery("");
    navigate(`/stock/${t}`);
  }

  const showDropdown = open && debounced.trim().length >= 2;

  return (
    <div ref={rootRef} className="relative w-full">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Search any Indian stock, ETF, or mutual fund…"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
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
              inputRef.current?.blur();
            }
          }}
          className="input w-full pl-9 pr-16 text-sm"
        />
        <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
          {isFetching && debounced.length >= 2 && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-subtle" />
          )}
          {query ? (
            <button
              type="button"
              aria-label="Clear"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="rounded p-1 text-fg-subtle hover:bg-white/5 hover:text-fg"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd className="kbd">⌘K</kbd>
          )}
        </div>
      </div>

      {showDropdown && (
        <div className="absolute left-0 right-0 z-40 mt-1 max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-bg-elevated shadow-card">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-fg-muted">
              {isFetching ? "Searching…" : "No matches."}
            </div>
          ) : (
            <ul>
              {results.map((r, i) => (
                <li
                  key={r.symbol}
                  onMouseEnter={() => setActiveIdx(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(r);
                  }}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 border-b border-border/40 px-4 py-2.5 last:border-0",
                    i === activeIdx && "bg-white/[0.05]",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-semibold",
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
          <div className="border-t border-border/40 px-4 py-2 text-[10px] text-fg-subtle">
            Results from Yahoo Finance. Live streaming is available only for
            tickers in the portfolio.
          </div>
        </div>
      )}
    </div>
  );
}

// Yahoo returns "RELIANCE.NS", "AAPL", "BTC-USD" — our routes expect the bare
// ticker (no .NS) since we map that on the backend.
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
