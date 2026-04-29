import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ActivePortfolioState {
  activeId: string | null;
  setActive: (id: string | null) => void;
}

/**
 * Persisted active-portfolio selection. The actual portfolio object is held
 * in the React Query cache via `usePortfolios`; this store only carries the
 * ID so we don't double-source the truth.
 *
 * `usePortfolios` reorders its result so the active portfolio is at index
 * 0 — every place in the app that reads `portfolios.data?.[0]` automatically
 * picks up the user's current selection without further wiring.
 */
export const useActivePortfolio = create<ActivePortfolioState>()(
  persist(
    (set) => ({
      activeId: null,
      setActive: (id) => set({ activeId: id }),
    }),
    { name: "stockapp-active-portfolio" },
  ),
);
