import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface HistoricalQuote {
  ticker: string;
  price: string;
  updatedAt: string;
}

/**
 * Pulls the server-side ring buffer of recent ticks for a ticker. The chart
 * seeds from this; subsequent updates come over the WebSocket.
 */
export function usePriceHistory(ticker: string | undefined) {
  return useQuery({
    queryKey: ["price-history", ticker],
    enabled: !!ticker,
    queryFn: async () => {
      const { data } = await api.get<{ ticker: string; items: HistoricalQuote[] }>(
        `/quotes/${ticker}/history?limit=240`,
      );
      return data.items;
    },
    // Only used to seed; we don't want it to refetch mid-session and
    // stomp the live stream.
    staleTime: 60_000,
  });
}
