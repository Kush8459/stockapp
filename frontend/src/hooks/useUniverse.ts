import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useUniverse() {
  return useQuery({
    queryKey: ["universe"],
    queryFn: async (): Promise<string[]> => {
      const { data } = await api.get<{ tickers: string[] }>("/universe");
      return data.tickers;
    },
    // The universe rarely changes in the mock feed and the worker re-seeds
    // on every restart — cache aggressively.
    staleTime: 5 * 60_000,
  });
}
