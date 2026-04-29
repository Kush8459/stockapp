import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface Goal {
  id: string;
  userId: string;
  portfolioId: string;
  name: string;
  /** Decimal as string. */
  targetAmount: string;
  /** ISO date "YYYY-MM-DD…". */
  targetDate: string;
  bucket?: string | null;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

export function useGoals() {
  return useQuery({
    queryKey: ["goals"],
    queryFn: async (): Promise<Goal[]> => {
      const { data } = await api.get<{ items: Goal[] }>("/goals");
      return data.items;
    },
    staleTime: 60_000,
  });
}

export interface CreateGoalInput {
  portfolioId: string;
  name: string;
  targetAmount: string;
  /** "YYYY-MM-DD" */
  targetDate: string;
  bucket?: string;
  note?: string;
}

export function useCreateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateGoalInput): Promise<Goal> => {
      const { data } = await api.post<Goal>("/goals", input);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}

export interface UpdateGoalInput {
  id: string;
  name?: string;
  targetAmount?: string;
  targetDate?: string;
  bucket?: string;
  note?: string;
}

export function useUpdateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateGoalInput): Promise<Goal> => {
      const { id, ...body } = input;
      const { data } = await api.patch<Goal>(`/goals/${id}`, body);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}

export function useDeleteGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/goals/${id}`);
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}
