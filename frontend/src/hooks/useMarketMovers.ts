import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Quote } from "./useLivePrices";

export interface MoversResponse {
  gainers: Quote[];
  losers: Quote[];
  total: number;
}

export interface IndexOption {
  slug: string;
  label: string;
}

/**
 * Top market gainers + losers. Optional `index` filter narrows the ranking
 * pool to that NSE index's constituents (e.g. "nifty50", "nifty500").
 * Refetches every 30 s; visible rows tick faster via the WS in
 * useLivePrices.
 */
export function useMarketMovers(opts: { index?: string; limit?: number } = {}) {
  const { index = "", limit = 5 } = opts;
  return useQuery({
    queryKey: ["market-movers", index, limit],
    queryFn: async (): Promise<MoversResponse> => {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (index) params.set("index", index);
      const { data } = await api.get<MoversResponse>(
        `/market/movers?${params.toString()}`,
      );
      return data;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

/**
 * Lists every NSE index the backend successfully loaded — drives the
 * movers filter dropdown.
 */
export function useAvailableIndices() {
  return useQuery({
    queryKey: ["market-indices"],
    queryFn: async (): Promise<IndexOption[]> => {
      const { data } = await api.get<{ items: IndexOption[] }>("/market/indices");
      return data.items;
    },
    staleTime: 10 * 60_000,
  });
}
