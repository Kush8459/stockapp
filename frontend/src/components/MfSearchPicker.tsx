import { useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, Search } from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce";
import { useMfCatalog, type MfFund } from "@/hooks/useMfCatalog";
import { cn, formatCurrency, toNum } from "@/lib/utils";

interface MfSearchPickerProps {
  /** The selected fund's ticker, e.g. "MF120586". Empty string when none. */
  value: string;
  onChange: (ticker: string) => void;
  /**
   * Fires when a user actually picks a result. The full fund record is
   * passed so the parent can show name / NAV / category alongside the
   * picker without an extra fetch.
   */
  onPick?: (fund: MfFund) => void;
  /** When the parent already knows the picked fund, pass it so the input
   *  can render its readable name without re-fetching the catalog. */
  selected?: MfFund | null;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Mutual-fund autocomplete backed by /mf/catalog (MF-only, AMFI Direct
 * Plan + Growth filtered). Used wherever stocks would be irrelevant —
 * SIPs being the obvious case in Indian retail apps.
 */
export function MfSearchPicker({
  value,
  onChange,
  onPick,
  selected,
  placeholder = "Search a mutual fund — e.g. Parag Parikh, Axis Bluechip…",
  disabled,
}: MfSearchPickerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState(selected?.name ?? "");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  // When the parent updates `selected` externally (e.g. after a server
  // round-trip), keep the visible query in sync with that fund's name.
  useEffect(() => {
    if (selected && selected.ticker === value) {
      setQuery(selected.name);
    } else if (!value) {
      setQuery("");
    }
  }, [selected, value]);

  const debounced = useDebounce(query, 250);
  // The catalog endpoint already returns funds filtered by free-text q.
  // Limit kept tight (15) to keep the dropdown scannable on mobile.
  const catalog = useMfCatalog({
    q: debounced,
    limit: 15,
  });
  const results = catalog.funds;

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

  function pick(f: MfFund) {
    onChange(f.ticker);
    onPick?.(f);
    setQuery(f.name);
    setOpen(false);
  }

  // Show the dropdown once the user has typed at least 2 chars OR has
  // explicitly opened it via the chevron — surfaces popular funds so a
  // user who doesn't know what to search for has somewhere to start.
  const showDropdown =
    open && (debounced.trim().length >= 2 || query.trim().length === 0);

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
            setQuery(e.target.value);
            // Clear the committed value when the user starts editing —
            // the parent should treat "typed but not picked" as no
            // selection rather than holding a stale ticker.
            if (value) onChange("");
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
          className="input w-full pl-9 pr-10"
          aria-autocomplete="list"
          aria-expanded={open}
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
          {catalog.isFetching && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-subtle" />
          )}
          <button
            type="button"
            aria-label="Toggle suggestions"
            onClick={() => setOpen((o) => !o)}
            className="rounded p-1 text-fg-subtle hover:bg-white/5 hover:text-fg"
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          </button>
        </div>
      </div>

      {showDropdown && (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-bg-elevated shadow-card">
          {catalog.isLoading ? (
            <div className="px-4 py-6 text-center text-sm text-fg-muted">
              Loading…
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-fg-muted">
              {debounced ? `No mutual funds match "${debounced}".` : "No funds available."}
            </div>
          ) : (
            <ul role="listbox">
              {results.map((f, i) => (
                <FundRow
                  key={f.ticker}
                  fund={f}
                  active={i === activeIdx}
                  onMouseEnter={() => setActiveIdx(i)}
                  onPick={() => pick(f)}
                />
              ))}
            </ul>
          )}
          {!debounced && results.length > 0 && (
            <div className="border-t border-border/40 px-4 py-2 text-[10px] text-fg-subtle">
              Type to filter across {results.length}+ Direct-Growth funds from
              AMFI.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FundRow({
  fund,
  active,
  onMouseEnter,
  onPick,
}: {
  fund: MfFund;
  active: boolean;
  onMouseEnter: () => void;
  onPick: () => void;
}) {
  const nav = fund.nav ? toNum(fund.nav.value) : 0;
  return (
    <li
      role="option"
      aria-selected={active}
      onMouseEnter={onMouseEnter}
      onMouseDown={(e) => {
        e.preventDefault();
        onPick();
      }}
      className={cn(
        "flex cursor-pointer items-center gap-3 border-b border-border/40 px-4 py-2.5 last:border-0",
        active && "bg-white/[0.05]",
      )}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-violet-500/15 text-[10px] font-semibold text-violet-300">
        {fund.amc.slice(0, 2).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-sm font-medium">{fund.name}</div>
        <div className="num truncate text-[11px] text-fg-muted">
          {fund.amc} · {fund.category}
        </div>
      </div>
      {nav > 0 && (
        <div className="num shrink-0 text-right">
          <div className="text-[11px] text-fg-subtle">NAV</div>
          <div className="text-sm font-medium">{formatCurrency(nav)}</div>
        </div>
      )}
    </li>
  );
}
