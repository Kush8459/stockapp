import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "dark" | "light";

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

/**
 * Theme store. Defaults to dark to preserve the historical UX. The chosen
 * theme is persisted in localStorage so the next page load doesn't flash
 * back to the default.
 *
 * The actual <html> class application is done in `App.tsx` via a useEffect
 * that subscribes to this store — keeping the side-effect out of the store
 * keeps it serialisable for SSR/tests.
 */
export const useTheme = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "dark",
      setTheme: (t) => set({ theme: t }),
      toggle: () => set({ theme: get().theme === "dark" ? "light" : "dark" }),
    }),
    {
      name: "stockapp-theme",
      partialize: (s) => ({ theme: s.theme }),
    },
  ),
);
