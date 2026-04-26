import { motion } from "framer-motion";
import { CalendarDays, Coins, Megaphone } from "lucide-react";
import { useFundamentals } from "@/hooks/useFundamentals";
import { useDividendSuggestions } from "@/hooks/useDividends";
import { cn, formatCurrency, toNum } from "@/lib/utils";

interface Props {
  ticker: string;
}

/**
 * Upcoming corporate events (earnings + dividend dates) plus a few of the
 * most recent past dividends. Combines Yahoo's calendarEvents (upcoming)
 * with chart events=div (history).
 */
export function EventsCard({ ticker }: Props) {
  const { data: fund, isLoading: fundLoading } = useFundamentals(ticker);
  const { data: divEvents = [], isLoading: divLoading } = useDividendSuggestions(ticker);

  const upcoming = collectUpcoming(fund);
  const recentDivs = divEvents
    .slice()
    .sort((a, b) => new Date(b.exDate).getTime() - new Date(a.exDate).getTime())
    .slice(0, 5);

  const empty = upcoming.length === 0 && recentDivs.length === 0;

  if (fundLoading || divLoading) {
    return (
      <section className="card p-5">
        <div className="label inline-flex items-center gap-1.5">
          <CalendarDays className="h-3 w-3" /> Events
        </div>
        <div className="mt-3 text-sm text-fg-muted">Loading…</div>
      </section>
    );
  }

  if (empty) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="card p-5"
    >
      <header className="mb-4">
        <div className="label inline-flex items-center gap-1.5">
          <CalendarDays className="h-3 w-3" /> Events
        </div>
        <p className="mt-1 text-xs text-fg-muted">
          Upcoming earnings and dividend dates from Yahoo, plus recent
          dividend history.
        </p>
      </header>

      {upcoming.length > 0 && (
        <div className="mb-5">
          <div className="label mb-2 text-fg-subtle">Upcoming</div>
          <ul className="divide-y divide-border/40 rounded-lg border border-border/40 bg-bg-soft/30">
            {upcoming.map((u, i) => (
              <li
                key={`${u.label}-${i}`}
                className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-md",
                      u.tone === "earnings"
                        ? "bg-warn/15 text-warn"
                        : "bg-success/15 text-success",
                    )}
                  >
                    {u.tone === "earnings" ? (
                      <Megaphone className="h-3.5 w-3.5" />
                    ) : (
                      <Coins className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <div>
                    <div className="font-medium">{u.label}</div>
                    <div className="num text-[11px] text-fg-muted">
                      {formatLong(u.date)} · {countdown(u.date)}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {recentDivs.length > 0 && (
        <div>
          <div className="label mb-2 text-fg-subtle">Recent dividends</div>
          <ul className="divide-y divide-border/40 rounded-lg border border-border/40 bg-bg-soft/30">
            {recentDivs.map((d, i) => (
              <li
                key={`${d.exDate}-${i}`}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-success/15 text-success">
                    <Coins className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <div className="num font-medium">
                      ₹{toNum(d.perShare).toFixed(2)}/share
                    </div>
                    <div className="num text-[11px] text-fg-muted">
                      ex-date {formatLong(d.exDate)}
                    </div>
                  </div>
                </div>
                {toNum(d.sharesOnDate) > 0 && (
                  <span className="num text-[11px] text-fg-muted">
                    you held {toNum(d.sharesOnDate).toLocaleString("en-IN", { maximumFractionDigits: 4 })} ·{" "}
                    <span className="text-success">{formatCurrency(toNum(d.amount))}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </motion.section>
  );
}

interface UpcomingEvent {
  label: string;
  date: string;
  tone: "earnings" | "dividend";
}

function collectUpcoming(f?: { nextEarningsDate?: string; exDividendDate?: string; dividendPayDate?: string }): UpcomingEvent[] {
  if (!f) return [];
  const now = new Date();
  const out: UpcomingEvent[] = [];
  if (f.nextEarningsDate && new Date(f.nextEarningsDate) > now) {
    out.push({ label: "Earnings call", date: f.nextEarningsDate, tone: "earnings" });
  }
  if (f.exDividendDate && new Date(f.exDividendDate) > now) {
    out.push({ label: "Ex-dividend date", date: f.exDividendDate, tone: "dividend" });
  }
  if (f.dividendPayDate && new Date(f.dividendPayDate) > now) {
    out.push({ label: "Dividend payment", date: f.dividendPayDate, tone: "dividend" });
  }
  out.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return out;
}

function formatLong(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function countdown(iso: string): string {
  const dt = new Date(iso).getTime();
  const now = Date.now();
  const days = Math.round((dt - now) / 86400000);
  if (days < 0) return `${-days}d ago`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 14) return `in ${days}d`;
  if (days < 60) return `in ${Math.round(days / 7)}w`;
  return `in ${Math.round(days / 30)}mo`;
}
