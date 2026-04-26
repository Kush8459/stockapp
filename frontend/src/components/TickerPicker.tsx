import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { useUniverse } from "@/hooks/useUniverse";
import { cn } from "@/lib/utils";

interface TickerPickerProps {
  value: string;
  onChange: (ticker: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Simple combobox that surfaces the server universe. Filters as you type;
 * picks the highlighted match on Enter. Keeps the input free so users can
 * still type a ticker not in the universe — the form can validate on submit.
 */
export function TickerPicker({
  value,
  onChange,
  placeholder = "Search ticker…",
  disabled,
}: TickerPickerProps) {
  const { data: universe = [] } = useUniverse();
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = value.trim().toUpperCase();
    if (!q) return universe.slice(0, 8);
    return universe.filter((t) => t.includes(q)).slice(0, 8);
  }, [value, universe]);

  useEffect(() => setActiveIdx(0), [value]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function pick(t: string) {
    onChange(t);
    setOpen(false);
  }

  return (
    <div className="relative" ref={rootRef}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
        <input
          className="input num pl-9 pr-9 uppercase"
          value={value}
          onChange={(e) => {
            onChange(e.target.value.toUpperCase());
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!open) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && filtered[activeIdx]) {
              e.preventDefault();
              pick(filtered[activeIdx]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          aria-autocomplete="list"
          aria-expanded={open}
        />
        <button
          type="button"
          aria-label="Toggle suggestions"
          onClick={() => setOpen((o) => !o)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-subtle hover:bg-white/5 hover:text-fg"
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {open && filtered.length > 0 && (
        <ul
          className="absolute left-0 right-0 z-20 mt-1 max-h-60 overflow-auto rounded-lg border border-border bg-bg-elevated py-1 shadow-card"
          role="listbox"
        >
          {filtered.map((t, i) => (
            <li
              key={t}
              role="option"
              aria-selected={i === activeIdx}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={(e) => {
                // mousedown, not click — fires before the input's blur.
                e.preventDefault();
                pick(t);
              }}
              className={cn(
                "num cursor-pointer px-3 py-2 text-sm",
                i === activeIdx ? "bg-white/[0.06] text-fg" : "text-fg-muted",
              )}
            >
              {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
