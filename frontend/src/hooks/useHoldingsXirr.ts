import { useQueries } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { XirrResult } from "@/hooks/usePnl";

/**
 * Fetches XIRR for every provided ticker in parallel. Returns a map keyed by
 * ticker so the caller can look up each holding row in O(1).
 */
export function useHoldingsXirr(portfolioId: string | undefined, tickers: string[]) {
  const results = useQueries({
    queries: tickers.map((ticker) => ({
      queryKey: ["xirr", "holding", portfolioId, ticker],
      enabled: !!portfolioId && !!ticker,
      queryFn: async (): Promise<XirrResult> => {
        const { data } = await api.get<XirrResult>(
          `/portfolios/${portfolioId}/holdings/${ticker}/xirr`,
        );
        return data;
      },
      staleTime: 60_000,
    })),
  });

  const map: Record<string, XirrResult | undefined> = {};
  tickers.forEach((t, i) => {
    map[t] = results[i]?.data;
  });
  const loading = results.some((r) => r.isLoading);
  return { byTicker: map, loading };
}
