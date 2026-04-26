import { NavLink, Outlet } from "react-router-dom";
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
} from "lucide-react";
import { useAuth } from "@/store/auth";
import { useLivePrices } from "@/hooks/useLivePrices";
import { cn } from "@/lib/utils";
import { SearchBar } from "./SearchBar";
import { MarketContextBar } from "./MarketContextBar";
import { MarketStatusBar } from "./MarketStatusBar";
import { SectorSidebar } from "./SectorSidebar";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/holdings", label: "Holdings", icon: LineChart },
  { to: "/watchlist", label: "Watchlist", icon: Eye },
  { to: "/transactions", label: "Transactions", icon: History },
  { to: "/sips", label: "SIPs", icon: CalendarClock },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/tax", label: "Tax", icon: Calculator },
];

export function AppShell() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const { connected } = useLivePrices();

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border/80 bg-bg-soft/50 backdrop-blur md:flex">
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
          <div className="leading-tight">
            <div className="font-semibold">Stockapp</div>
            <div className="text-[11px] text-fg-muted">Investments</div>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 px-3">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) =>
                cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-white/5 text-fg"
                    : "text-fg-muted hover:bg-white/5 hover:text-fg",
                )
              }
            >
              <item.icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-border/80 p-3">
          <div className="flex items-center gap-3 rounded-lg px-3 py-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500/30 to-violet-500/30 text-sm font-medium">
              {(user?.displayName ?? user?.email ?? "?").slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm">{user?.displayName ?? "Investor"}</div>
              <div className="truncate text-[11px] text-fg-muted">{user?.email}</div>
            </div>
            <button
              type="button"
              onClick={logout}
              className="rounded-md p-1.5 text-fg-muted hover:bg-white/5 hover:text-fg"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-5 pb-16 md:px-8">
        <div className="sticky top-0 z-30 -mx-5 mb-6 space-y-2 border-b border-border/70 bg-bg/70 px-5 py-3 backdrop-blur md:-mx-8 md:px-8">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <SearchBar />
            </div>
            <MarketStatusBar />
          </div>
          <MarketContextBar />
        </div>
        <Outlet />
      </main>

      <SectorSidebar />
    </div>
  );
}
