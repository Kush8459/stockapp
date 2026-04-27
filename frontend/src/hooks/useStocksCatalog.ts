import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@/lib/api";
import type { Quote } from "@/hooks/useLivePrices";

export interface StockCard {
  ticker: string;
  name?: string;
  exchange?: string;
  quote?: Quote;
}

export interface CategoryItem {
  id: string;
  label: string;
  count?: number;
}

export interface CategoryGroup {
  name: string;
  items: CategoryItem[];
}

export function useStocksCategories() {
  return useQuery({
    queryKey: ["stocks", "categories"],
    queryFn: async (): Promise<CategoryGroup[]> => {
      const { data } = await api.get<{ groups: CategoryGroup[] }>(
        "/stocks/categories",
      );
      return data.groups;
    },
    staleTime: 30 * 60 * 1000,
  });
}

interface StocksCatalogPage {
  items: StockCard[];
  total: number;
  offset: number;
  hasMore: boolean;
}

export function useStocksCatalog(args: {
  category?: string;
  q?: string;
  limit?: number;
}) {
  const { category = "", q = "", limit = 30 } = args;
  // Blank slate: no filter, no query — skip the fetch. The page renders
  // a "type to search or pick a filter" hint instead.
  const enabled = !!category || q.trim().length > 0;
  const query = useInfiniteQuery({
    queryKey: ["stocks", "catalog", category, q, limit],
    enabled,
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<StocksCatalogPage> => {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (q) params.set("q", q);
      params.set("limit", String(limit));
      params.set("offset", String(pageParam));
      const { data } = await api.get<StocksCatalogPage>(
        `/stocks/catalog?${params}`,
      );
      return data;
    },
    getNextPageParam: (last) =>
      last.hasMore ? last.offset + last.items.length : undefined,
    // Live ticks come over the WebSocket; we don't need to refetch
    // pages on a polling timer — that would be expensive once the user
    // has scrolled deep, and wouldn't add anything the WS doesn't already.
    staleTime: 30 * 1000,
  });

  const stocks = useMemo<StockCard[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );
  const total = query.data?.pages[0]?.total ?? 0;

  return { ...query, stocks, total };
}
