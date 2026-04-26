import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface XirrResult {
  rate: number | null;
  flowCount: number;
  insufficient?: boolean;
}

export function usePortfolioXirr(portfolioId: string | undefined) {
  return useQuery({
    queryKey: ["xirr", "portfolio", portfolioId],
    enabled: !!portfolioId,
    queryFn: async (): Promise<XirrResult> => {
      const { data } = await api.get<XirrResult>(`/portfolios/${portfolioId}/xirr`);
      return data;
    },
    // XIRR is slow to change — refresh less aggressively than the dashboard.
    refetchInterval: 60_000,
  });
}

export function useHoldingXirr(portfolioId: string | undefined, ticker: string | undefined) {
  return useQuery({
    queryKey: ["xirr", "holding", portfolioId, ticker],
    enabled: !!portfolioId && !!ticker,
    queryFn: async (): Promise<XirrResult> => {
      const { data } = await api.get<XirrResult>(
        `/portfolios/${portfolioId}/holdings/${ticker}/xirr`,
      );
      return data;
    },
    refetchInterval: 60_000,
  });
}
