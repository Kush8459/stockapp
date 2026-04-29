import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface Wallet {
  id: string;
  userId: string;
  balance: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface WalletMovement {
  id: string;
  walletId: string;
  userId: string;
  kind: "deposit" | "withdraw" | "buy" | "sell" | "charge" | "refund";
  /** Signed amount: positive = credit, negative = debit. */
  amount: string;
  balanceAfter: string;
  method?: string | null;
  reference?: string | null;
  transactionId?: string | null;
  note?: string | null;
  createdAt: string;
}

export type DepositMethod = "upi" | "bank" | "card";

export function useWallet() {
  return useQuery({
    queryKey: ["wallet"],
    queryFn: async (): Promise<Wallet> => {
      const { data } = await api.get<Wallet>("/wallet");
      return data;
    },
    refetchInterval: 30_000,
    staleTime: 5_000,
  });
}

export function useWalletHistory(limit = 50) {
  return useQuery({
    queryKey: ["wallet-history", limit],
    queryFn: async (): Promise<WalletMovement[]> => {
      const { data } = await api.get<{ items: WalletMovement[] }>(
        `/wallet/transactions?limit=${limit}`,
      );
      return data.items;
    },
    refetchInterval: 30_000,
  });
}

interface MovementInput {
  amount: string;
  method: DepositMethod;
  reference?: string;
  note?: string;
}

export function useDeposit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: MovementInput) => {
      const { data } = await api.post<{
        movement: WalletMovement;
        balanceAfter: string;
      }>("/wallet/deposit", input);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wallet"] });
      qc.invalidateQueries({ queryKey: ["wallet-history"] });
    },
  });
}

export function useWithdraw() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: MovementInput) => {
      const { data } = await api.post<{
        movement: WalletMovement;
        balanceAfter: string;
      }>("/wallet/withdraw", input);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wallet"] });
      qc.invalidateQueries({ queryKey: ["wallet-history"] });
    },
  });
}
