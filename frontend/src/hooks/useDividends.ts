import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface Dividend {
  id: string;
  portfolioId?: string | null;
  ticker: string;
  assetType: string;
  perShare: string;
  shares: string;
  amount: string;
  tds: string;
  netAmount: string;
  paymentDate: string;
  exDate?: string | null;
  note?: string | null;
  createdAt: string;
}

export interface DividendSummary {
  yearToDate: string;
  financialYear: string;
  allTime: string;
  count: number;
  fyLabel: string;
  byTicker: Array<{
    ticker: string;
    total: string;
    netTotal: string;
    count: number;
    lastPaid: string;
  }>;
}

export function useDividends(ticker?: string) {
  return useQuery({
    queryKey: ["dividends", ticker ?? "all"],
    queryFn: async (): Promise<Dividend[]> => {
      const url = ticker
        ? `/dividends?ticker=${encodeURIComponent(ticker)}`
        : "/dividends";
      const { data } = await api.get<{ items: Dividend[] }>(url);
      return data.items;
    },
    staleTime: 60_000,
  });
}

export function useDividendSummary() {
  return useQuery({
    queryKey: ["dividends-summary"],
    queryFn: async (): Promise<DividendSummary> => {
      const { data } = await api.get<DividendSummary>("/dividends/summary");
      return data;
    },
    staleTime: 60_000,
  });
}

export interface CreateDividendInput {
  portfolioId?: string | null;
  ticker: string;
  assetType?: string;
  perShare?: string;
  shares: string;
  amount?: string;
  tds?: string;
  paymentDate: string; // YYYY-MM-DD
  exDate?: string;
  note?: string;
}

export function useCreateDividend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateDividendInput): Promise<Dividend> => {
      const { data } = await api.post<Dividend>("/dividends", input);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dividends"] });
      qc.invalidateQueries({ queryKey: ["dividends-summary"] });
    },
  });
}

export interface DividendSuggestion {
  ticker: string;
  exDate: string;
  perShare: string;
  sharesOnDate: string;
  amount: string;
  alreadyLogged: boolean;
}

/**
 * Auto-suggested past dividends from Yahoo's chart events feed, filtered
 * to dates the user actually held the ticker. Each row can be one-click
 * imported into the manual log.
 */
export function useDividendSuggestions(ticker: string | undefined) {
  return useQuery({
    queryKey: ["dividends-suggested", ticker],
    queryFn: async (): Promise<DividendSuggestion[]> => {
      const { data } = await api.get<{ items: DividendSuggestion[] }>(
        `/dividends/suggested?ticker=${encodeURIComponent(ticker!)}`,
      );
      return data.items;
    },
    enabled: !!ticker,
    staleTime: 30 * 60_000,
    retry: 1,
  });
}

export function useDeleteDividend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/dividends/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dividends"] });
      qc.invalidateQueries({ queryKey: ["dividends-summary"] });
    },
  });
}
