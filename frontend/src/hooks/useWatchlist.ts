import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Quote } from "./useLivePrices";

export interface Watchlist {
  id: string;
  name: string;
  sortOrder: number;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WatchlistItem {
  id: string;
  watchlistId: string;
  ticker: string;
  assetType: "stock" | "mf";
  sortOrder: number;
  createdAt: string;
  quote?: Quote;
}

const WL_KEY = ["watchlists"] as const;

export function useWatchlists() {
  return useQuery({
    queryKey: WL_KEY,
    queryFn: async (): Promise<Watchlist[]> => {
      const { data } = await api.get<{ items: Watchlist[] }>("/watchlists");
      return data.items;
    },
    staleTime: 30_000,
  });
}

export function useWatchlistItems(listID: string | undefined) {
  return useQuery({
    queryKey: ["watchlist-items", listID],
    queryFn: async (): Promise<WatchlistItem[]> => {
      const { data } = await api.get<{ items: WatchlistItem[] }>(
        `/watchlists/${listID}`,
      );
      return data.items;
    },
    enabled: !!listID,
    staleTime: 15_000,
  });
}

export function useCreateWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string): Promise<Watchlist> => {
      const { data } = await api.post<Watchlist>("/watchlists", { name });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: WL_KEY }),
  });
}

export function useRenameWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; name: string }) => {
      await api.patch(`/watchlists/${input.id}`, { name: input.name });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: WL_KEY }),
  });
}

export function useDeleteWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/watchlists/${id}`);
    },
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: WL_KEY });
      qc.invalidateQueries({ queryKey: ["watchlist-items", id] });
    },
  });
}

export function useAddToWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      listId: string;
      ticker: string;
      assetType?: string;
    }) => {
      const { data } = await api.post<WatchlistItem>(
        `/watchlists/${input.listId}/items`,
        { ticker: input.ticker, assetType: input.assetType ?? "stock" },
      );
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: WL_KEY });
      qc.invalidateQueries({ queryKey: ["watchlist-items", vars.listId] });
      qc.invalidateQueries({ queryKey: ["watchlist-memberships", vars.ticker] });
    },
  });
}

export function useRemoveFromWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      listId: string;
      ticker: string;
      assetType?: string;
    }) => {
      await api.delete(
        `/watchlists/${input.listId}/items/${encodeURIComponent(input.ticker)}?assetType=${input.assetType ?? "stock"}`,
      );
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: WL_KEY });
      qc.invalidateQueries({ queryKey: ["watchlist-items", vars.listId] });
      qc.invalidateQueries({ queryKey: ["watchlist-memberships", vars.ticker] });
    },
  });
}

/**
 * Returns the IDs of every watchlist this ticker is on. Used by the
 * star-button popover to checkbox the lists the user has added the
 * ticker to.
 */
export function useWatchlistMemberships(
  ticker: string,
  assetType: string = "stock",
) {
  return useQuery({
    queryKey: ["watchlist-memberships", ticker, assetType],
    queryFn: async (): Promise<Set<string>> => {
      const { data } = await api.get<{ watchlistIds: string[] }>(
        `/watchlists/memberships/${encodeURIComponent(ticker)}?assetType=${assetType}`,
      );
      return new Set(data.watchlistIds);
    },
    enabled: !!ticker,
    staleTime: 30_000,
  });
}
