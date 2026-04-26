import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { api } from "@/lib/api";

export type HealthLabel = "Excellent" | "Good" | "Fair" | "Needs attention";
export type Severity = "high" | "medium" | "low";
export type Priority = "high" | "medium" | "low";
export type Category = "rebalance" | "research" | "risk" | "discipline";

export interface Highlight {
  ticker: string;
  value: string;
  note: string;
}

export interface KeyHighlights {
  topPerformer?: Highlight;
  topLaggard?: Highlight;
  biggestPosition?: Highlight;
  fastestMover?: Highlight;
}

export interface HealthScore {
  overall: number;
  label: HealthLabel;
  diversification: number;
  riskManagement: number;
  performance: number;
  discipline: number;
}

export interface Analysis {
  allocation: string;
  concentration: string;
  performance: string;
  discipline: string;
}

export interface Strength {
  title: string;
  detail: string;
}

export interface Risk {
  title: string;
  detail: string;
  severity: Severity;
}

export interface Suggestion {
  title: string;
  detail: string;
  priority: Priority;
  category: Category;
}

export interface InputSummary {
  holdings: number;
  transactions: number;
  sips: number;
}

export interface Insight {
  executiveSummary: string;
  healthScore: HealthScore;
  keyHighlights: KeyHighlights;
  analysis: Analysis;
  strengths: Strength[];
  risks: Risk[];
  suggestions: Suggestion[];
  nextSteps: string[];

  generatedAt: string;
  model: string;
  cached: boolean;
  input: InputSummary;
}

export interface InsightError {
  kind: "disabled" | "upstream" | "other";
  message: string;
}

function toStructuredError(err: unknown): InsightError {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const code = (err.response?.data as { code?: string })?.code;
    const message =
      (err.response?.data as { message?: string })?.message ?? err.message;
    if (status === 503 || code === "insights_disabled") {
      return { kind: "disabled", message };
    }
    if (status === 502 || code === "insights_upstream") {
      return { kind: "upstream", message };
    }
  }
  return {
    kind: "other",
    message: err instanceof Error ? err.message : "Unknown error",
  };
}

export function useInsights() {
  return useQuery({
    queryKey: ["insights"],
    retry: false,
    // Always refetch on mount so a previous-error state doesn't persist
    // across navigations.
    refetchOnMount: "always",
    queryFn: async (): Promise<Insight> => {
      // Debug aid — confirms from the browser devtools console that the
      // hook is actually firing a request.
      // eslint-disable-next-line no-console
      console.debug("[insights] GET /insights firing");
      try {
        const { data } = await api.get<Insight>("/insights");
        return data;
      } catch (err) {
        throw toStructuredError(err);
      }
    },
  });
}

export function useRefreshInsights() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<Insight> => {
      try {
        const { data } = await api.post<Insight>("/insights/refresh");
        return data;
      } catch (err) {
        throw toStructuredError(err);
      }
    },
    onSuccess: (data) => qc.setQueryData(["insights"], data),
  });
}
