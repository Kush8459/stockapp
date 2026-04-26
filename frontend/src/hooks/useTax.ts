import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type Term = "short" | "long";
export type Category = "stcg_equity" | "ltcg_equity";

export interface Realization {
  ticker: string;
  assetType: string;
  quantity: string;
  buyDate: string;
  buyPrice: string;
  sellDate: string;
  sellPrice: string;
  holdingDays: number;
  proceeds: string;
  costBasis: string;
  gain: string;
  term: Term;
  category: Category;
  sellTransactionId: string;
}

export interface YearSummary {
  financialYear: string;
  startDate: string;
  endDate: string;

  stcgEquityGain: string;
  stcgEquityTax: string;

  ltcgEquityGain: string;
  ltcgExemptionUsed: string;
  ltcgTaxableGain: string;
  ltcgEquityTax: string;

  totalGain: string;
  totalTax: string;
  effectiveRate: string;

  realizations: Realization[];
}

export interface Unrealized {
  stcgEquityGain: string;
  ltcgEquityGain: string;
  totalGain: string;
}

export interface Rates {
  stcgEquityPct: string;
  ltcgEquityPct: string;
  ltcgExemption: string;
  longTermHoldingDays: number;
}

export interface TaxReport {
  generatedAt: string;
  currency: string;
  years: YearSummary[];
  unrealized: Unrealized;
  rates: Rates;
}

export function useTaxReport() {
  return useQuery({
    queryKey: ["tax-report"],
    queryFn: async (): Promise<TaxReport> => {
      const { data } = await api.get<TaxReport>("/tax/summary");
      return data;
    },
    staleTime: 60_000,
  });
}
