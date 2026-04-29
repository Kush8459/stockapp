import { useMemo } from "react";
import { useTheme } from "@/store/theme";

/**
 * Theme-aware colors for recharts / lightweight-charts. Recharts's `stroke`
 * and `tick.fill` props can't read CSS variables directly (the SVG output
 * needs concrete colors), so we resolve them here based on the theme store.
 *
 * Memoised on `theme` so the returned object is reference-stable across
 * renders. LiveChart depends on this value in its create-chart effect; if
 * we returned a fresh object every call the chart would rebuild on every
 * parent re-render and the history-seed effect (keyed on `history` only)
 * wouldn't re-run, leaving an empty canvas.
 */
const dark = {
  bg: "#07090d",
  bgSoft: "#141b26",
  border: "#1c2431",
  fg: "#e7ecf3",
  fgMuted: "#8a95a6",
  fgSubtle: "#5b6678",
};
const light = {
  bg: "#ffffff",
  bgSoft: "#f1f5f9",
  border: "#e2e8f0",
  fg: "#0f172a",
  fgMuted: "#64748b",
  fgSubtle: "#94a3b8",
};

export function useChartTheme() {
  const theme = useTheme((s) => s.theme);
  return useMemo(() => (theme === "light" ? light : dark), [theme]);
}
