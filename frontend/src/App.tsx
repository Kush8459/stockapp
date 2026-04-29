import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { LoginPage } from "@/pages/Login";
import { RegisterPage } from "@/pages/Register";
import { DashboardPage } from "@/pages/Dashboard";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/store/auth";
import { useTheme } from "@/store/theme";

// Heavier / less-visited pages load on demand so the initial bundle stays
// lean. Dashboard + Login stay eager because one of them renders on first paint.
const StockDetailPage = lazy(() =>
  import("@/pages/StockDetail").then((m) => ({ default: m.StockDetailPage })),
);
const TransactionsPage = lazy(() =>
  import("@/pages/Transactions").then((m) => ({ default: m.TransactionsPage })),
);
const TransactionDetailPage = lazy(() =>
  import("@/pages/TransactionDetail").then((m) => ({ default: m.TransactionDetailPage })),
);
const AlertsPage = lazy(() =>
  import("@/pages/Alerts").then((m) => ({ default: m.AlertsPage })),
);
const SipsPage = lazy(() =>
  import("@/pages/Sips").then((m) => ({ default: m.SipsPage })),
);
const HoldingsPage = lazy(() =>
  import("@/pages/Holdings").then((m) => ({ default: m.HoldingsPage })),
);
const TaxPage = lazy(() =>
  import("@/pages/Tax").then((m) => ({ default: m.TaxPage })),
);
const SectorDetailPage = lazy(() =>
  import("@/pages/SectorDetail").then((m) => ({ default: m.SectorDetailPage })),
);
const WatchlistPage = lazy(() =>
  import("@/pages/Watchlist").then((m) => ({ default: m.WatchlistPage })),
);
const StocksPage = lazy(() =>
  import("@/pages/Stocks").then((m) => ({ default: m.StocksPage })),
);
const MutualFundsPage = lazy(() =>
  import("@/pages/MutualFunds").then((m) => ({ default: m.MutualFundsPage })),
);
const MutualFundDetailPage = lazy(() =>
  import("@/pages/MutualFundDetail").then((m) => ({
    default: m.MutualFundDetailPage,
  })),
);
const ProfilePage = lazy(() =>
  import("@/pages/Profile").then((m) => ({ default: m.ProfilePage })),
);

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuth((s) => s.accessToken);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RouteLoader() {
  return (
    <div className="flex h-full items-center justify-center py-24 text-fg-muted">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
    </div>
  );
}

// React Router v6 doesn't auto-scroll to top on navigation. Without this,
// clicking a stock from far down the dashboard scrolls the new page to the
// same position it was at before (mid-page).
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);
  return null;
}

// Reflect the current theme onto <html>'s class list. The pre-paint inline
// script in index.html sets the initial value; this just keeps it in sync
// after the user toggles.
function ThemeSync() {
  const theme = useTheme((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
    root.classList.toggle("dark", theme === "dark");
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.setAttribute("content", theme);
  }, [theme]);
  return null;
}

export default function App() {
  return (
    <>
      <ThemeSync />
      <ScrollToTop />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route
          path="/stock/:ticker"
          element={
            <Suspense fallback={<RouteLoader />}>
              <StockDetailPage />
            </Suspense>
          }
        />
        <Route
          path="/transactions"
          element={
            <Suspense fallback={<RouteLoader />}>
              <TransactionsPage />
            </Suspense>
          }
        />
        <Route
          path="/transactions/:id"
          element={
            <Suspense fallback={<RouteLoader />}>
              <TransactionDetailPage />
            </Suspense>
          }
        />
        <Route
          path="/alerts"
          element={
            <Suspense fallback={<RouteLoader />}>
              <AlertsPage />
            </Suspense>
          }
        />
        <Route
          path="/sips"
          element={
            <Suspense fallback={<RouteLoader />}>
              <SipsPage />
            </Suspense>
          }
        />
        <Route
          path="/holdings"
          element={
            <Suspense fallback={<RouteLoader />}>
              <HoldingsPage />
            </Suspense>
          }
        />
        <Route
          path="/tax"
          element={
            <Suspense fallback={<RouteLoader />}>
              <TaxPage />
            </Suspense>
          }
        />
        <Route
          path="/sector/:slug"
          element={
            <Suspense fallback={<RouteLoader />}>
              <SectorDetailPage />
            </Suspense>
          }
        />
        <Route
          path="/watchlist"
          element={
            <Suspense fallback={<RouteLoader />}>
              <WatchlistPage />
            </Suspense>
          }
        />
        <Route
          path="/stocks"
          element={
            <Suspense fallback={<RouteLoader />}>
              <StocksPage />
            </Suspense>
          }
        />
        <Route
          path="/funds"
          element={
            <Suspense fallback={<RouteLoader />}>
              <MutualFundsPage />
            </Suspense>
          }
        />
        <Route
          path="/funds/:ticker"
          element={
            <Suspense fallback={<RouteLoader />}>
              <MutualFundDetailPage />
            </Suspense>
          }
        />
        <Route
          path="/profile"
          element={
            <Suspense fallback={<RouteLoader />}>
              <ProfilePage />
            </Suspense>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
