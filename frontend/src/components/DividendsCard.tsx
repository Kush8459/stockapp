import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, Coins, Download, Loader2, Trash2 } from "lucide-react";
import {
  useCreateDividend,
  useDeleteDividend,
  useDividends,
  useDividendSuggestions,
  type Dividend,
  type DividendSuggestion,
} from "@/hooks/useDividends";
import { usePortfolios } from "@/hooks/usePortfolio";
import { useToast } from "@/components/Toaster";
import { cn, formatCurrency, toNum } from "@/lib/utils";

interface Props {
  ticker: string;
}

/**
 * Per-ticker dividend log. Auto-driven: suggestions come from Yahoo's
 * dividend history filtered to dates the user actually held shares; user
 * one-click imports the ones they received. The "logged" list shows what
 * has been imported.
 */
export function DividendsCard({ ticker }: Props) {
  const { data = [], isLoading } = useDividends(ticker);
  const portfolios = usePortfolios();
  const portfolioID = portfolios.data?.[0]?.id;

  const totals = useMemo(() => {
    const all = data.reduce((s, d) => s + toNum(d.netAmount), 0);
    const fyStart = financialYearStart();
    const fy = data
      .filter((d) => new Date(d.paymentDate) >= fyStart)
      .reduce((s, d) => s + toNum(d.netAmount), 0);
    return { all, fy };
  }, [data]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="card p-5"
    >
      <header className="mb-4">
        <div className="label inline-flex items-center gap-1.5">
          <Coins className="h-3 w-3" /> Dividends received
        </div>
        <p className="mt-1 text-xs text-fg-muted">
          Pulled from Yahoo's history, filtered to dates you actually held
          shares. Click <span className="font-medium text-fg">Import</span> on
          any row you received.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4">
        <Stat label="This FY (net)" value={formatCurrency(totals.fy)} tone={totals.fy > 0 ? "pos" : undefined} />
        <Stat label="Lifetime (net)" value={formatCurrency(totals.all)} />
      </div>

      <SuggestionsSection ticker={ticker} portfolioID={portfolioID} />

      <div className="mt-5">
        <div className="label mb-2 text-fg-subtle">Logged</div>
        {isLoading ? (
          <div className="text-sm text-fg-muted">Loading…</div>
        ) : data.length === 0 ? (
          <div className="rounded-lg border border-border/40 bg-bg-soft/30 px-3 py-4 text-center text-xs text-fg-muted">
            No dividends imported yet — pick from the suggestions above.
          </div>
        ) : (
          <List items={data} />
        )}
      </div>
    </motion.section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "pos" }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={cn("num mt-0.5 text-lg font-semibold", tone === "pos" && "pos")}>
        {value}
      </div>
    </div>
  );
}

function SuggestionsSection({
  ticker,
  portfolioID,
}: {
  ticker: string;
  portfolioID?: string;
}) {
  const { data: suggestions = [], isLoading, isError } = useDividendSuggestions(ticker);
  const create = useCreateDividend();
  const { push } = useToast();
  const [hideLogged, setHideLogged] = useState(true);

  const filtered = useMemo(
    () => (hideLogged ? suggestions.filter((s) => !s.alreadyLogged) : suggestions),
    [suggestions, hideLogged],
  );

  if (isLoading) {
    return (
      <div className="mt-5 text-xs text-fg-subtle">Looking up Yahoo dividend history…</div>
    );
  }
  if (isError) {
    return null; // silently skip — Yahoo doesn't cover every ticker
  }
  if (suggestions.length === 0) {
    return (
      <div className="mt-5 rounded-lg border border-border/40 bg-bg-soft/30 px-3 py-3 text-center text-[11px] text-fg-muted">
        Yahoo has no dividend history for this ticker over your holding period.
      </div>
    );
  }

  async function importOne(s: DividendSuggestion) {
    try {
      await create.mutateAsync({
        portfolioId: portfolioID ?? null,
        ticker: s.ticker,
        assetType: "stock",
        perShare: s.perShare,
        shares: s.sharesOnDate,
        amount: s.amount,
        paymentDate: s.exDate.slice(0, 10),
        note: "Imported from Yahoo",
      });
      push({
        kind: "success",
        title: `Imported · ${s.ticker} ${formatCurrency(toNum(s.amount))}`,
        description: `Ex-date ${new Date(s.exDate).toLocaleDateString()}`,
      });
    } catch (e) {
      push({ kind: "error", title: "Import failed", description: String(e) });
    }
  }

  async function importAll() {
    for (const s of filtered) {
      // eslint-disable-next-line no-await-in-loop
      await importOne(s);
    }
  }

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <div className="label">Suggested ({filtered.length})</div>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-[11px] text-fg-muted">
            <input
              type="checkbox"
              checked={hideLogged}
              onChange={(e) => setHideLogged(e.target.checked)}
              className="accent-brand"
            />
            Hide already logged
          </label>
          {filtered.length > 1 && (
            <button
              type="button"
              onClick={importAll}
              disabled={create.isPending}
              className="btn-outline h-7 px-2 text-[11px]"
            >
              {create.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
              Import all
            </button>
          )}
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-border/40 bg-bg-soft/30 px-3 py-3 text-center text-[11px] text-fg-muted">
          All known dividends already logged.
        </div>
      ) : (
        <ul className="divide-y divide-border/40 rounded-lg border border-border/40 bg-bg-soft/30">
          {filtered.map((s, i) => (
            <SuggestionRow
              key={`${s.ticker}-${s.exDate}-${i}`}
              s={s}
              onImport={() => importOne(s)}
              busy={create.isPending}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SuggestionRow({
  s,
  onImport,
  busy,
}: {
  s: DividendSuggestion;
  onImport: () => void;
  busy: boolean;
}) {
  const dt = new Date(s.exDate);
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <div>
        <div className="num font-medium">
          {formatCurrency(toNum(s.amount))}
          <span className="ml-2 text-[11px] font-normal text-fg-muted">
            ₹{toNum(s.perShare).toFixed(2)}/sh × {toNum(s.sharesOnDate).toLocaleString("en-IN", { maximumFractionDigits: 4 })}
          </span>
        </div>
        <div className="num text-[11px] text-fg-subtle">
          ex-date {dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
        </div>
      </div>
      {s.alreadyLogged ? (
        <span className="num inline-flex items-center gap-1 text-[11px] text-fg-subtle">
          <Check className="h-3 w-3" /> already logged
        </span>
      ) : (
        <button
          type="button"
          onClick={onImport}
          disabled={busy}
          className="btn-outline h-7 px-2 text-[11px]"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          Import
        </button>
      )}
    </li>
  );
}

function List({ items }: { items: Dividend[] }) {
  const remove = useDeleteDividend();
  const { push } = useToast();
  return (
    <ul className="divide-y divide-border/40">
      {items.slice(0, 8).map((d) => {
        const dt = new Date(d.paymentDate);
        return (
          <li
            key={d.id}
            className="flex items-center justify-between gap-3 py-2.5 text-sm"
          >
            <div>
              <div className="num font-medium">{formatCurrency(toNum(d.amount))}</div>
              <div className="num text-[11px] text-fg-muted">
                {toNum(d.shares).toLocaleString("en-IN", { maximumFractionDigits: 4 })} sh ·
                {toNum(d.perShare) > 0 ? ` ₹${toNum(d.perShare).toFixed(2)}/sh` : ""}
                {toNum(d.tds) > 0 ? ` · TDS ${formatCurrency(toNum(d.tds))}` : ""}
              </div>
            </div>
            <div className="text-right">
              <div className="num text-[11px] text-fg-muted">
                {dt.toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </div>
              {d.note && (
                <div className="text-[11px] text-fg-subtle">{d.note}</div>
              )}
            </div>
            <button
              type="button"
              aria-label="Delete dividend"
              onClick={() =>
                remove.mutate(d.id, {
                  onSuccess: () => push({ kind: "info", title: "Dividend deleted" }),
                })
              }
              className="rounded-md p-1.5 text-fg-subtle hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        );
      })}
      {items.length > 8 && (
        <li className="pt-2 text-center text-[11px] text-fg-subtle">
          +{items.length - 8} earlier payment{items.length - 8 === 1 ? "" : "s"}
        </li>
      )}
    </ul>
  );
}

function financialYearStart(): Date {
  const now = new Date();
  const istNow = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
  );
  const year = istNow.getMonth() < 3 ? istNow.getFullYear() - 1 : istNow.getFullYear();
  return new Date(`${year}-04-01T00:00:00+05:30`);
}
