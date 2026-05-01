import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@/lib/api";

export interface MfNav {
  value: string;
  changePct?: string;
  asOf: string;
  stale: boolean;
}

export interface MfFund {
  ticker: string;
  schemeCode: number;
  name: string;
  amc: string;
  category: string;
  planType: string;
  option: string;
  nav?: MfNav;
  // Catalog-embedded returns (% — absolute for 1Y, annualised CAGR for 3Y/5Y).
  // Optional: missing means the fund's history doesn't reach back that far.
  oneYear?: number;
  threeYear?: number;
  fiveYear?: number;
}

export type MfSortKey =
  | "oneYear-desc"
  | "oneYear-asc"
  | "threeYear-desc"
  | "threeYear-asc"
  | "fiveYear-desc"
  | "fiveYear-asc";

export interface MfCategory {
  category: string;
  count: number;
}

export function useMfCategories() {
  return useQuery({
    queryKey: ["mf", "categories"],
    queryFn: async (): Promise<MfCategory[]> => {
      const { data } = await api.get<{ items: MfCategory[] }>("/mf/categories");
      return data.items;
    },
    staleTime: 30 * 60 * 1000,
  });
}

interface MfCatalogPage {
  items: MfFund[];
  total: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Paginated MF catalog. Returns all loaded pages flattened as `funds`
 * for callers that just want the data, plus the underlying infinite-
 * query controls (`fetchNextPage`, `hasNextPage`, `isFetchingNextPage`)
 * for pages that wire infinite scroll.
 *
 * Callers that only want the first page (e.g. similar-funds rail) can
 * read `funds` and slice — the trailing pages aren't fetched until
 * something explicitly calls `fetchNextPage()`.
 */
export function useMfCatalog(args: {
  category?: string;
  q?: string;
  limit?: number;
  sort?: MfSortKey | "";
}) {
  const { category = "", q = "", limit = 24, sort = "" } = args;
  const query = useInfiniteQuery({
    queryKey: ["mf", "catalog", category, q, limit, sort],
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<MfCatalogPage> => {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (q) params.set("q", q);
      if (sort) params.set("sort", sort);
      params.set("limit", String(limit));
      params.set("offset", String(pageParam));
      const { data } = await api.get<MfCatalogPage>(`/mf/catalog?${params}`);
      return data;
    },
    getNextPageParam: (last) =>
      last.hasMore ? last.offset + last.items.length : undefined,
    staleTime: 5 * 60 * 1000,
  });

  // Flatten pages once per change so callers don't see duplicate work
  // on each render.
  const funds = useMemo<MfFund[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );
  const total = query.data?.pages[0]?.total ?? 0;

  return { ...query, funds, total };
}

export function useMfFund(ticker: string | undefined) {
  return useQuery({
    queryKey: ["mf", "fund", ticker],
    enabled: !!ticker,
    queryFn: async (): Promise<MfFund> => {
      const { data } = await api.get<MfFund>(`/mf/funds/${ticker}`);
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export interface MfReturns {
  ticker: string;
  schemeCode: number;
  navCurrent: string;
  navAsOf: string;
  inceptionDate: string;
  historyDays: number;
  oneMonth?: number;
  threeMonth?: number;
  sixMonth?: number;
  oneYear?: number;
  threeYear?: number;
  fiveYear?: number;
  tenYear?: number;
  sinceInception?: number;
  highestNav?: string;
  highestNavDate?: string;
  lowestNav?: string;
  lowestNavDate?: string;
}

export function useMfReturns(ticker: string | undefined) {
  return useQuery({
    queryKey: ["mf", "returns", ticker],
    enabled: !!ticker,
    queryFn: async (): Promise<MfReturns> => {
      const { data } = await api.get<MfReturns>(`/mf/funds/${ticker}/returns`);
      return data;
    },
    staleTime: 30 * 60 * 1000,
  });
}

export interface MfDrawdown {
  percentDecline: number;
  peakDate: string;
  peakNav: string;
  troughDate: string;
  troughNav: string;
  recoveryDate?: string;
  durationDays: number;
}

export interface MfYearReturn {
  year: number;
  return: number;
}

export interface MfRollingStats {
  windowDays: number;
  sampleCount: number;
  bestReturn: number;
  worstReturn: number;
  averageReturn: number;
  medianReturn: number;
}

export interface MfMetrics {
  ticker: string;
  schemeCode: number;
  historyDays: number;
  navPointCount: number;
  riskFreeRate: number;
  volatility?: number;
  sharpeRatio?: number;
  maxDrawdown?: MfDrawdown;
  bestYear?: MfYearReturn;
  worstYear?: MfYearReturn;
  yearlyReturns?: MfYearReturn[];
  upMonthsPct?: number;
  downMonthsPct?: number;
  rolling1y?: MfRollingStats;
}

export function useMfMetrics(ticker: string | undefined) {
  return useQuery({
    queryKey: ["mf", "metrics", ticker],
    enabled: !!ticker,
    queryFn: async (): Promise<MfMetrics> => {
      const { data } = await api.get<MfMetrics>(`/mf/funds/${ticker}/metrics`);
      return data;
    },
    staleTime: 60 * 60 * 1000,
  });
}
