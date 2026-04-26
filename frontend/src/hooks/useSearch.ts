import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  shortName?: string;
}

export function useSearch(query: string) {
  return useQuery({
    queryKey: ["search", query],
    enabled: query.trim().length >= 2,
    queryFn: async (): Promise<SearchResult[]> => {
      const { data } = await api.get<{ items: SearchResult[] }>(
        `/search?q=${encodeURIComponent(query)}&limit=10`,
      );
      return data.items;
    },
    staleTime: 60_000,
  });
}
