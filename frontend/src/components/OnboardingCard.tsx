import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  Plus,
  Search,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import {
  useHoldings,
  usePortfolios,
  useTransactions,
} from "@/hooks/usePortfolio";
import { useWallet } from "@/hooks/useWallet";
import { cn, formatCurrency, toNum } from "@/lib/utils";

interface OnboardingCardProps {
  /** Open the wallet dialog (deposit). Provided by the parent so we don't
   *  duplicate the WalletDialog mount. */
  onAddFunds: () => void;
}

/**
 * Three-step welcome card shown only to fresh accounts (0 holdings and
 * 0 transactions). Disappears the moment the user places their first
 * trade — a "graduation" rather than a closeable banner, so re-opening
 * the dashboard after a trade looks clean.
 *
 * Each step has a tick that lights up as the user completes it, so the
 * card itself becomes a progress meter for the first session.
 */
export function OnboardingCard({ onAddFunds }: OnboardingCardProps) {
  const navigate = useNavigate();
  const portfolios = usePortfolios();
  const portfolio = portfolios.data?.[0];
  const holdings = useHoldings(portfolio?.id);
  const txns = useTransactions();
  const wallet = useWallet();

  const balance = toNum(wallet.data?.balance);
  const hasHoldings = (holdings.data ?? []).length > 0;
  const hasTransactions = (txns.data ?? []).length > 0;

  // Hide once the user has any history. Loading states defer rendering so
  // the card doesn't flash on every mount before queries settle.
  if (holdings.isLoading || txns.isLoading || wallet.isLoading) return null;
  if (hasHoldings || hasTransactions) return null;

  // Step states: wallet has the seed → step 1 done; ditto for placing
  // first trade → step 3 done. Step 2 is the search action; we treat
  // it as in-progress until the user clicks through.
  const steps = [
    {
      id: "fund",
      icon: Plus,
      title: "Fund your wallet",
      body:
        balance > 0
          ? `You have ${formatCurrency(balance)} in paper-trading cash, ready to invest. Add more anytime.`
          : "Add some paper-trading cash to start placing trades.",
      cta: balance > 0 ? "Add more funds" : "Add funds",
      onClick: onAddFunds,
      done: balance > 0,
    },
    {
      id: "discover",
      icon: Search,
      title: "Find something to buy",
      body:
        "Search any Indian stock or browse 5,000+ mutual funds by category. Real-time prices, AMFI-direct NAVs.",
      cta: "Browse stocks",
      onClick: () => navigate("/stocks"),
      done: false,
    },
    {
      id: "trade",
      icon: TrendingUp,
      title: "Place your first trade",
      body:
        "Open a stock or fund page and hit Buy. Charges + wallet impact are shown before you confirm.",
      cta: "Open holdings",
      onClick: () => navigate("/holdings"),
      done: hasHoldings,
    },
  ];

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="card relative overflow-hidden p-6"
    >
      {/* Decorative gradient — light enough to read text against in both themes. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand/10 via-transparent to-violet-500/10 opacity-70"
      />
      <div className="relative">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand" />
          <span className="text-[11px] font-medium uppercase tracking-wider text-brand">
            Welcome to Stockapp
          </span>
        </div>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">
          Three steps to your first investment
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          Paper trading at live market prices — no real money moves, but
          everything else (charges, holdings, P&L) behaves like a real broker.
        </p>

        <ol className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={s.onClick}
                className={cn(
                  "group flex h-full w-full flex-col gap-3 rounded-xl border bg-bg-soft/40 p-4 text-left transition-colors",
                  s.done
                    ? "border-success/40 hover:border-success"
                    : "border-border hover:border-border-strong",
                )}
              >
                <div className="flex items-center justify-between">
                  <div
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-lg",
                      s.done
                        ? "bg-success/15 text-success"
                        : "bg-brand/15 text-brand",
                    )}
                  >
                    {s.done ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : (
                      <s.icon className="h-5 w-5" />
                    )}
                  </div>
                  <span className="num text-[10px] uppercase tracking-wider text-fg-subtle">
                    Step {i + 1}
                  </span>
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{s.title}</div>
                  <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">
                    {s.body}
                  </p>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-xs font-medium",
                    s.done ? "text-success" : "text-brand",
                  )}
                >
                  {s.done ? "Done" : s.cta}
                  {!s.done && (
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  )}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </motion.section>
  );
}
