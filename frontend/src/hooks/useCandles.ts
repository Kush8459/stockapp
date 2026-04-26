import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type ChartRange = "1d" | "1w" | "1m" | "3m" | "1y" | "5y" | "max";

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Fetches historical OHLC candles for the given ticker and range. */
export function useCandles(ticker: string | undefined, range: ChartRange) {
  return useQuery({
    queryKey: ["candles", ticker, range],
    enabled: !!ticker,
    queryFn: async (): Promise<Candle[]> => {
      const { data } = await api.get<{ items: Candle[] }>(
        `/quotes/${ticker}/candles?range=${range}`,
      );
      return data.items ?? [];
    },
    // Backend caches 2m–24h per range; UI stale-time matches short end.
    staleTime: 2 * 60_000,
  });
}
