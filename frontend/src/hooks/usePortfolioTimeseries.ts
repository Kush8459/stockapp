import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type SeriesRange = "1m" | "3m" | "6m" | "1y" | "5y" | "all";

export interface SeriesPoint {
  /** Unix seconds at 00:00 UTC of the calendar day. */
  time: number;
  /** Mark-to-market portfolio value on that day. */
  value: string;
  /** Running cost basis (sum of buys − cost of units sold). */
  invested: string;
}

export interface PortfolioSeries {
  points: SeriesPoint[];
  firstTxnDate?: string;
  range: SeriesRange;
  startValue: string;
  startInvested: string;
}

/**
 * Daily portfolio-value series replayed from the user's transactions.
 * Heavy enough that we cache aggressively — the underlying numbers
 * only change when the user trades or the day rolls over.
 */
export function usePortfolioTimeseries(
  portfolioId: string | undefined,
  range: SeriesRange,
) {
  return useQuery({
    queryKey: ["portfolio-timeseries", portfolioId, range],
    enabled: !!portfolioId,
    queryFn: async (): Promise<PortfolioSeries> => {
      const { data } = await api.get<PortfolioSeries>(
        `/portfolios/${portfolioId}/timeseries?range=${range}`,
      );
      return data;
    },
    staleTime: 5 * 60_000,
  });
}
