import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface SipPlan {
  id: string;
  userId: string;
  portfolioId: string;
  ticker: string;
  assetType: "stock" | "mf";
  amount: string;
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  nextRunAt: string;
  status: "active" | "paused" | "cancelled";
  /** Set by the scheduler when it auto-pauses the plan, e.g. when the
   *  wallet was empty at runtime. NULL means user-paused or never paused. */
  pauseReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export function useSips() {
  return useQuery({
    queryKey: ["sips"],
    queryFn: async (): Promise<SipPlan[]> => {
      const { data } = await api.get<{ items: SipPlan[] }>("/sips");
      return data.items;
    },
    refetchInterval: 20_000,
  });
}

export function useCreateSip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      portfolioId: string;
      ticker: string;
      assetType: "stock" | "mf";
      amount: string;
      frequency: "daily" | "weekly" | "monthly" | "yearly";
      firstRunAt?: string;
    }) => {
      const { data } = await api.post<SipPlan>("/sips", input);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sips"] }),
  });
}

export function useUpdateSipStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status: "active" | "paused" | "cancelled" }) => {
      await api.patch(`/sips/${input.id}`, { status: input.status });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sips"] }),
  });
}

export function useUpdateSip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      amount?: string;
      frequency?: "monthly" | "yearly";
      nextRunAt?: string; // RFC3339
    }) => {
      const { id, ...body } = input;
      await api.patch(`/sips/${id}`, body);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sips"] }),
  });
}

export function useCancelSip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/sips/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sips"] }),
  });
}
