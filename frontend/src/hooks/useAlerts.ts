import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface Alert {
  id: string;
  userId: string;
  ticker: string;
  targetPrice: string;
  direction: "above" | "below";
  triggered: boolean;
  triggeredAt?: string | null;
  createdAt: string;
}

export function useAlerts() {
  return useQuery({
    queryKey: ["alerts"],
    queryFn: async (): Promise<Alert[]> => {
      const { data } = await api.get<{ items: Alert[] }>("/alerts");
      return data.items;
    },
    refetchInterval: 15_000,
  });
}

export function useCreateAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      ticker: string;
      targetPrice: string;
      direction: "above" | "below";
    }) => {
      const { data } = await api.post<Alert>("/alerts", input);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });
}

export function useDeleteAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/alerts/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });
}
