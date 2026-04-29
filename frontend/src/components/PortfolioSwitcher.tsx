import { useEffect, useRef, useState } from "react";
import {
  Briefcase,
  Check,
  ChevronDown,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { apiErrorMessage } from "@/lib/api";
import {
  useCreatePortfolio,
  useDeletePortfolio,
  usePortfolios,
  useRenamePortfolio,
} from "@/hooks/usePortfolio";
import { useActivePortfolio } from "@/store/activePortfolio";
import { useToast } from "./Toaster";
import { cn } from "@/lib/utils";

/**
 * Topbar dropdown that picks which portfolio drives the dashboard, holdings,
 * tax view, etc. Active selection is persisted in localStorage so the user's
 * choice survives reloads.
 *
 * Most users will only ever have one portfolio — for them this collapses to
 * a quiet pill showing the portfolio name, with a "+ new" affordance hidden
 * inside the dropdown so it doesn't clutter the topbar.
 */
export function PortfolioSwitcher() {
  const portfolios = usePortfolios();
  const setActive = useActivePortfolio((s) => s.setActive);
  const list = portfolios.data ?? [];
  const active = list[0]; // usePortfolios reorders so [0] is the selected one
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (portfolios.isLoading) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg-soft/50 px-2.5 py-1.5 text-xs text-fg-muted"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading…
      </button>
    );
  }
  if (!active) return null;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex max-w-[200px] items-center gap-1.5 rounded-lg border border-border bg-bg-soft/50 px-2.5 py-1.5 text-xs hover:border-border-strong hover:bg-overlay/5"
        aria-label="Switch portfolio"
        aria-expanded={open}
      >
        <Briefcase className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
        <span className="truncate font-medium">{active.name}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-fg-subtle transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <DropdownPanel
          activeId={active.id}
          list={list}
          onPick={(id) => {
            setActive(id);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function DropdownPanel({
  activeId,
  list,
  onPick,
  onClose,
}: {
  activeId: string;
  list: Array<{ id: string; name: string }>;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const create = useCreatePortfolio();
  const rename = useRenamePortfolio();
  const remove = useDeletePortfolio();
  const { push } = useToast();

  async function submitCreate() {
    const name = draft.trim();
    if (!name) return;
    try {
      await create.mutateAsync(name);
      push({ kind: "success", title: `Created portfolio "${name}"` });
      setCreating(false);
      setDraft("");
      onClose();
    } catch (e) {
      push({
        kind: "error",
        title: "Couldn't create portfolio",
        description: apiErrorMessage(e),
      });
    }
  }

  async function submitRename(id: string) {
    const name = draft.trim();
    if (!name) return;
    try {
      await rename.mutateAsync({ id, name });
      push({ kind: "info", title: `Renamed to "${name}"` });
      setEditId(null);
      setDraft("");
    } catch (e) {
      push({
        kind: "error",
        title: "Couldn't rename portfolio",
        description: apiErrorMessage(e),
      });
    }
  }

  async function confirmDelete(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return;
    try {
      await remove.mutateAsync(id);
      push({ kind: "info", title: `Deleted "${name}"` });
    } catch (e) {
      push({
        kind: "error",
        title: "Couldn't delete portfolio",
        description: apiErrorMessage(e),
      });
    }
  }

  return (
    <div className="absolute right-0 z-40 mt-1 w-72 rounded-xl border border-border bg-bg-elevated p-1.5 shadow-card">
      <ul className="max-h-72 space-y-0.5 overflow-y-auto scrollbar-none">
        {list.map((p) => {
          const isActive = p.id === activeId;
          const isEditing = editId === p.id;
          return (
            <li key={p.id}>
              {isEditing ? (
                <div className="flex items-center gap-1 rounded-md border border-border bg-bg-soft px-2 py-1.5">
                  <input
                    type="text"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitRename(p.id);
                      if (e.key === "Escape") {
                        setEditId(null);
                        setDraft("");
                      }
                    }}
                    autoFocus
                    className="input !py-1 !pl-2 !pr-1 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => submitRename(p.id)}
                    disabled={rename.isPending || !draft.trim()}
                    className="rounded p-1 text-success hover:bg-overlay/5"
                    aria-label="Save name"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditId(null);
                      setDraft("");
                    }}
                    className="rounded p-1 text-fg-muted hover:bg-overlay/5"
                    aria-label="Cancel"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div
                  className={cn(
                    "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                    isActive ? "bg-overlay/5" : "hover:bg-overlay/5",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onPick(p.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <Briefcase
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        isActive ? "text-brand" : "text-fg-muted",
                      )}
                    />
                    <span className={cn("truncate", isActive && "font-medium")}>
                      {p.name}
                    </span>
                    {isActive && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-brand" />
                    )}
                  </button>
                  <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => {
                        setEditId(p.id);
                        setDraft(p.name);
                      }}
                      className="rounded p-1 text-fg-muted hover:bg-overlay/5 hover:text-fg"
                      aria-label="Rename"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    {list.length > 1 && (
                      <button
                        type="button"
                        onClick={() => confirmDelete(p.id, p.name)}
                        className="rounded p-1 text-fg-muted hover:bg-overlay/5 hover:text-danger"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="my-1 border-t border-border/60" />

      {creating ? (
        <div className="flex items-center gap-1 rounded-md border border-border bg-bg-soft px-2 py-1.5">
          <input
            type="text"
            value={draft}
            placeholder="e.g. Retirement, Tax saving"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCreate();
              if (e.key === "Escape") {
                setCreating(false);
                setDraft("");
              }
            }}
            autoFocus
            className="input !py-1 !pl-2 !pr-1 text-sm"
          />
          <button
            type="button"
            onClick={submitCreate}
            disabled={create.isPending || !draft.trim()}
            className="rounded p-1 text-brand hover:bg-overlay/5"
            aria-label="Create"
          >
            {create.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(false);
              setDraft("");
            }}
            className="rounded p-1 text-fg-muted hover:bg-overlay/5"
            aria-label="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-fg-muted hover:bg-overlay/5 hover:text-fg"
        >
          <Plus className="h-3.5 w-3.5" /> New portfolio
        </button>
      )}
    </div>
  );
}
