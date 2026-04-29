import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Wallet2,
  LayoutDashboard,
  LineChart,
  History,
  Bell,
  CalendarClock,
  Calculator,
  LogOut,
  Eye,
  Layers,
  Menu,
  Moon,
  Sun,
  TrendingUp,
  X,
} from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { useAuth } from "@/store/auth";
import { useTheme } from "@/store/theme";
import { useLivePrices } from "@/hooks/useLivePrices";
import { useWallet } from "@/hooks/useWallet";
import { cn, formatCurrency, toNum } from "@/lib/utils";
import { SearchBar } from "./SearchBar";
import { ConnectionBanner } from "./ConnectionBanner";
import { MarketContextBar } from "./MarketContextBar";
import { MarketStatusBar } from "./MarketStatusBar";
import { PortfolioSwitcher } from "./PortfolioSwitcher";
import { SectorSidebar } from "./SectorSidebar";
import { WalletDialog } from "./WalletDialog";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/holdings", label: "Holdings", icon: LineChart },
  { to: "/stocks", label: "Stocks", icon: TrendingUp },
  { to: "/funds", label: "Mutual funds", icon: Layers },
  { to: "/watchlist", label: "Watchlist", icon: Eye },
  { to: "/transactions", label: "Transactions", icon: History },
  { to: "/sips", label: "SIPs", icon: CalendarClock },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/tax", label: "Tax", icon: Calculator },
];

export function AppShell() {
  const [walletOpen, setWalletOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  // Close the mobile drawer on every navigation. Without this it lingers
  // open after a tap and feels broken on phones.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar — hidden on mobile in favour of a drawer. */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border/80 bg-bg-soft/50 backdrop-blur md:flex">
        <SidebarContent onWallet={() => setWalletOpen(true)} />
      </aside>

      <main className="min-w-0 flex-1 px-4 pb-16 md:px-8">
        {/* Top bar. Hamburger + compact wallet pill on mobile, search + market
            status on tablet+. */}
        <div className="sticky top-0 z-30 -mx-4 mb-4 space-y-2 border-b border-border/70 bg-bg/70 px-4 py-3 backdrop-blur md:-mx-8 md:mb-6 md:px-8">
          <div className="flex items-center gap-2 md:gap-3">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="rounded-md p-2 text-fg-muted hover:bg-overlay/5 hover:text-fg md:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <SearchBar />
            </div>
            <div className="hidden sm:block">
              <PortfolioSwitcher />
            </div>
            <MarketStatusBar />
          </div>
          {/* Hide the dense market-context bar on small screens; it's noisy
              under 600px and the indices are still reachable from the menu. */}
          <div className="hidden sm:block">
            <MarketContextBar />
          </div>
          <ConnectionBanner />
        </div>
        <Outlet />
      </main>

      <SectorSidebar />

      {/* Mobile drawer — same nav surface as desktop. Slides in from left. */}
      <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden" />
          <Dialog.Content
            className={cn(
              "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[88vw] flex-col",
              "border-r border-border bg-bg-card shadow-glow md:hidden",
            )}
          >
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <Dialog.Description className="sr-only">
              App pages, wallet, and account links.
            </Dialog.Description>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close menu"
                className="absolute right-3 top-4 rounded-md p-1.5 text-fg-muted hover:bg-overlay/5 hover:text-fg"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
            <SidebarContent onWallet={() => setWalletOpen(true)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <WalletDialog open={walletOpen} onOpenChange={setWalletOpen} />
    </div>
  );
}

// Shared sidebar content — same JSX renders in the desktop aside and the
// mobile drawer. Connection dot + theme toggle live in the header row.
function SidebarContent({ onWallet }: { onWallet: () => void }) {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const { connected } = useLivePrices();
  const wallet = useWallet();
  const balance = toNum(wallet.data?.balance);
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggle);

  return (
    <>
      <div className="flex items-center gap-2.5 px-5 pb-5 pt-6">
        <div className="relative">
          <Wallet2 className="h-6 w-6 text-brand" />
          <span
            className={cn(
              "absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full",
              connected ? "bg-success" : "bg-fg-subtle",
            )}
          />
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="font-semibold">Stockapp</div>
          <div className="text-[11px] text-fg-muted">Investments</div>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-overlay/5 hover:text-fg"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 scrollbar-none">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end
            className={({ isActive }) =>
              cn(
                "group flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-overlay/5 text-fg"
                  : "text-fg-muted hover:bg-overlay/5 hover:text-fg",
              )
            }
          >
            <item.icon className="h-4 w-4" />
            <span className="flex-1">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="space-y-2 border-t border-border/80 p-3">
        <button
          type="button"
          onClick={onWallet}
          className="group flex min-h-[44px] w-full items-center gap-3 rounded-lg border border-border/60 bg-bg-soft/50 px-3 py-2 text-left transition-colors hover:border-border-strong hover:bg-overlay/5"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand/15 text-brand">
            <Wallet2 className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-[10px] uppercase tracking-wider text-fg-muted">
              Wallet
            </div>
            <div className="num truncate text-sm font-medium">
              {formatCurrency(balance)}
            </div>
          </div>
          <span className="num text-[10px] text-fg-subtle group-hover:text-fg">
            + Add
          </span>
        </button>
        <div className="flex items-center gap-2">
          <Link
            to="/profile"
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-overlay/5"
            aria-label="Open profile"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500/30 to-violet-500/30 text-sm font-medium">
              {(user?.displayName ?? user?.email ?? "?").slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm">
                {user?.displayName ?? "Investor"}
              </div>
              <div className="truncate text-[11px] text-fg-muted">
                {user?.email}
              </div>
            </div>
          </Link>
          <button
            type="button"
            onClick={logout}
            className="rounded-md p-2 text-fg-muted hover:bg-overlay/5 hover:text-fg"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  );
}
