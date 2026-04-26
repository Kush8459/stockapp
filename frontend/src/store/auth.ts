import axios from "axios";
import { create } from "zustand";
import { persist } from "zustand/middleware";

const baseURL = (import.meta.env.VITE_API_URL ?? "http://localhost:8080") + "/api/v1";

export interface AuthUser {
  id: string;
  email: string;
  displayName?: string;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => void;
  /** Returns the new access token or null on failure. */
  refreshSession: () => Promise<string | null>;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      async login(email, password) {
        const { data } = await axios.post(`${baseURL}/auth/login`, { email, password });
        set({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          user: data.user,
        });
      },
      async register(email, password, displayName) {
        const { data } = await axios.post(`${baseURL}/auth/register`, {
          email,
          password,
          displayName,
        });
        set({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          user: data.user,
        });
      },
      logout() {
        set({ accessToken: null, refreshToken: null, user: null });
      },
      async refreshSession() {
        const rt = get().refreshToken;
        if (!rt) return null;
        try {
          const { data } = await axios.post(`${baseURL}/auth/refresh`, {
            refreshToken: rt,
          });
          set({
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
            user: data.user,
          });
          return data.accessToken as string;
        } catch {
          set({ accessToken: null, refreshToken: null, user: null });
          return null;
        }
      },
    }),
    {
      name: "stockapp-auth",
      partialize: (s) => ({
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
        user: s.user,
      }),
    },
  ),
);
