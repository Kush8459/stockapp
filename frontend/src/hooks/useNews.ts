import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { api } from "@/lib/api";

export type Sentiment = "positive" | "neutral" | "negative";

export interface NewsArticle {
  title: string;
  description: string;
  url: string;
  source: string;
  publishedAt: string;
  sentiment: Sentiment;
  score: number;
}

export interface NewsError {
  kind: "disabled" | "upstream" | "other";
  message: string;
}

/**
 * Fetches news for a ticker. Returns either an array of articles or a
 * structured error so the UI can render distinct empty states for
 * "provider offline" vs "admin didn't configure a key".
 */
export function useNews(ticker: string | undefined) {
  return useQuery({
    queryKey: ["news", ticker],
    enabled: !!ticker,
    // NewsAPI + our 30-min Redis cache; refetching more often wastes quota.
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async (): Promise<NewsArticle[]> => {
      try {
        const { data } = await api.get<{ items: NewsArticle[] }>(`/news/${ticker}`);
        return data.items;
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 503) {
          const code = (err.response?.data as { code?: string })?.code;
          const e: NewsError = {
            kind: code === "news_disabled" ? "disabled" : "upstream",
            message:
              (err.response?.data as { message?: string })?.message ??
              "News unavailable",
          };
          // Throw structured — the component catches via `error` field.
          throw e;
        }
        throw err;
      }
    },
  });
}
