import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  Holding,
  Portfolio,
  Summary,
  Transaction,
  TransactionDetail,
} from "@/lib/types";

export function usePortfolios() {
  return useQuery({
    queryKey: ["portfolios"],
    queryFn: async (): Promise<Portfolio[]> => {
      const { data } = await api.get<{ items: Portfolio[] }>("/portfolios");
      return data.items;
    },
  });
}

export function useHoldings(portfolioId: string | undefined) {
  return useQuery({
    queryKey: ["holdings", portfolioId],
    enabled: !!portfolioId,
    queryFn: async (): Promise<Holding[]> => {
      const { data } = await api.get<{ items: Holding[] }>(
        `/portfolios/${portfolioId}/holdings`,
      );
      return data.items;
    },
    refetchInterval: 10_000,
  });
}

export function useSummary(portfolioId: string | undefined) {
  return useQuery({
    queryKey: ["summary", portfolioId],
    enabled: !!portfolioId,
    queryFn: async (): Promise<Summary> => {
      const { data } = await api.get<Summary>(`/portfolios/${portfolioId}/summary`);
      return data;
    },
    refetchInterval: 10_000,
  });
}

export function useTransactions() {
  return useQuery({
    queryKey: ["transactions"],
    queryFn: async (): Promise<Transaction[]> => {
      const { data } = await api.get<{ items: Transaction[] }>("/transactions");
      return data.items;
    },
  });
}

export function useTransactionDetail(id: string | undefined) {
  return useQuery({
    queryKey: ["transaction", id],
    enabled: !!id,
    queryFn: async (): Promise<TransactionDetail> => {
      const { data } = await api.get<TransactionDetail>(`/transactions/${id}`);
      return data;
    },
  });
}
