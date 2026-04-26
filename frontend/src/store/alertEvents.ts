import { create } from "zustand";

export interface AlertEvent {
  alertId: string;
  userId: string;
  ticker: string;
  direction: "above" | "below";
  targetPrice: string;
  price: string;
  triggeredAt: string;
}

interface AlertEventsState {
  recent: AlertEvent[];
  push: (e: AlertEvent) => void;
  clear: () => void;
}

/**
 * Recent alert.triggered events seen over the WebSocket. The Alerts page
 * replays this alongside the server list so users see new fires instantly
 * without waiting on refetch.
 */
export const useAlertEvents = create<AlertEventsState>((set) => ({
  recent: [],
  push: (e) =>
    set((s) => ({
      recent: [e, ...s.recent.filter((x) => x.alertId !== e.alertId)].slice(0, 20),
    })),
  clear: () => set({ recent: [] }),
}));
