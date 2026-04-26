import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface YearlyFinancials {
  year: number;
  endDate: string;
  totalRevenue?: number;
  grossProfit?: number;
  operatingIncome?: number;
  netIncome?: number;
  ebitda?: number;
}

export interface BalanceSheetPeriod {
  year: number;
  endDate: string;
  totalAssets?: number;
  totalLiabilities?: number;
  stockholderEquity?: number;
  longTermDebt?: number;
  shortTermDebt?: number;
  cash?: number;
}

export interface CashFlowPeriod {
  year: number;
  endDate: string;
  operatingCashFlow?: number;
  investingCashFlow?: number;
  financingCashFlow?: number;
  capEx?: number;
  freeCashFlow?: number;
  dividendsPaid?: number;
}

export interface Fundamentals {
  symbol: string;
  marketCap?: number;
  trailingPE?: number;
  forwardPE?: number;
  priceToBook?: number;
  eps?: number;
  enterpriseValue?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  beta?: number;
  averageVolume?: number;
  dividendYield?: number; // fraction (0.025 = 2.5%)
  dividendRate?: number; // ₹ / share / year
  payoutRatio?: number;
  profitMargins?: number;
  returnOnEquity?: number;
  debtToEquity?: number;
  sector?: string;
  industry?: string;
  fullTimeEmployees?: number;
  description?: string;
  website?: string;
  // Calendar events
  nextEarningsDate?: string;
  exDividendDate?: string;
  dividendPayDate?: string;
  // Income statement history (newest first)
  financials?: YearlyFinancials[];
  quarterlyFinancials?: YearlyFinancials[];
  // Balance sheet history (newest first)
  balanceSheets?: BalanceSheetPeriod[];
  quarterlyBalanceSheets?: BalanceSheetPeriod[];
  // Cash flow history (newest first)
  cashFlows?: CashFlowPeriod[];
  quarterlyCashFlows?: CashFlowPeriod[];
  currency?: string;
  updatedAt: string;
}

export function useFundamentals(ticker: string | undefined) {
  return useQuery({
    queryKey: ["fundamentals", ticker],
    queryFn: async (): Promise<Fundamentals> => {
      const { data } = await api.get<Fundamentals>(
        `/quotes/${encodeURIComponent(ticker!)}/fundamentals`,
      );
      return data;
    },
    enabled: !!ticker,
    staleTime: 60 * 60_000, // 1 hour
    retry: 1, // don't hammer Yahoo if it 404s
  });
}
