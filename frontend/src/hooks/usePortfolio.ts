import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@/lib/api";
import { useActivePortfolio } from "@/store/activePortfolio";
import type {
  Holding,
  Portfolio,
  Summary,
  Transaction,
  TransactionDetail,
} from "@/lib/types";

/**
 * Lists every portfolio the user owns, with the currently-active one
 * (per the persisted store) reordered to index 0. Most call sites read
 * `portfolios.data?.[0]` to mean "the user's primary portfolio" — this
 * reordering makes that mean "the user's *selected* portfolio" without
 * any further code changes.
 */
export function usePortfolios() {
  const activeId = useActivePortfolio((s) => s.activeId);
  const query = useQuery({
    queryKey: ["portfolios"],
    queryFn: async (): Promise<Portfolio[]> => {
      const { data } = await api.get<{ items: Portfolio[] }>("/portfolios");
      return data.items;
    },
  });

  const reordered = useMemo(() => {
    const list = query.data ?? [];
    if (!activeId || list.length === 0) return list;
    const i = list.findIndex((p) => p.id === activeId);
    if (i <= 0) return list;
    // Active first, then the rest in original order.
    return [list[i], ...list.slice(0, i), ...list.slice(i + 1)];
  }, [query.data, activeId]);

  return { ...query, data: reordered };
}

export function useCreatePortfolio() {
  const qc = useQueryClient();
  const setActive = useActivePortfolio((s) => s.setActive);
  return useMutation({
    mutationFn: async (name: string): Promise<Portfolio> => {
      const { data } = await api.post<Portfolio>("/portfolios", { name });
      return data;
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["portfolios"] });
      // Switch to the new portfolio so the dashboard reflects it immediately.
      setActive(p.id);
    },
  });
}

export function useRenamePortfolio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; name: string }): Promise<Portfolio> => {
      const { data } = await api.patch<Portfolio>(`/portfolios/${input.id}`, {
        name: input.name,
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolios"] });
    },
  });
}

export function useDeletePortfolio() {
  const qc = useQueryClient();
  const setActive = useActivePortfolio((s) => s.setActive);
  const activeId = useActivePortfolio((s) => s.activeId);
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/portfolios/${id}`);
      return id;
    },
    onSuccess: (deletedId) => {
      // Clear the active selection if the user just deleted the active
      // one — the next render of usePortfolios will pick the new index 0.
      if (activeId === deletedId) setActive(null);
      qc.invalidateQueries({ queryKey: ["portfolios"] });
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
