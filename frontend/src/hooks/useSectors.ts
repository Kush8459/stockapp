import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Quote } from "./useLivePrices";

export interface SectorView {
  name: string;
  slug: string;
  indexTicker: string;
  quote?: Quote;
}

export interface SectorComponent {
  ticker: string;
  quote?: Quote;
}

export interface SectorDetail {
  name: string;
  slug: string;
  indexTicker: string;
  indexQuote?: Quote;
  components: SectorComponent[];
}

/**
 * Lists every NSE sectoral index with its current quote. The right sidebar
 * uses this for metadata (slug, label, indexTicker), but live numbers come
 * from useLivePrices so the row updates tick-by-tick without re-fetching.
 */
export function useSectors() {
  return useQuery({
    queryKey: ["sectors"],
    queryFn: async (): Promise<SectorView[]> => {
      const { data } = await api.get<{ items: SectorView[] }>("/sectors");
      return data.items;
    },
    staleTime: 60_000,
  });
}

export function useSectorDetail(slug: string | undefined) {
  return useQuery({
    queryKey: ["sector", slug],
    queryFn: async (): Promise<SectorDetail> => {
      const { data } = await api.get<SectorDetail>(`/sectors/${slug}`);
      return data;
    },
    enabled: !!slug,
    staleTime: 30_000,
  });
}
