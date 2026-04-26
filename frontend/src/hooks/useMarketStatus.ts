import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type MarketStatus = "open" | "preopen" | "closed" | "holiday" | "weekend";

export interface MarketSnapshot {
  status: MarketStatus;
  label: string;
  holidayName?: string;
  nowIST: string;
  nextOpen: string;
  nextClose?: string;
}

/**
 * Polls /api/v1/market/status every 60 s. The backend computes the answer
 * from a fixed NSE holiday list + IST clock — no provider call, so the
 * cadence is irrelevant to rate limits and we can be lazy.
 */
export function useMarketStatus() {
  return useQuery({
    queryKey: ["market-status"],
    queryFn: async (): Promise<MarketSnapshot> => {
      const { data } = await api.get<MarketSnapshot>("/market/status");
      return data;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
