import axios, { AxiosError } from "axios";
import { useAuth } from "@/store/auth";

const baseURL = (import.meta.env.VITE_API_URL ?? "http://localhost:8080") + "/api/v1";

export const api = axios.create({ baseURL });

api.interceptors.request.use((cfg) => {
  const token = useAuth.getState().accessToken;
  if (token) {
    cfg.headers.Authorization = `Bearer ${token}`;
  }
  return cfg;
});

let refreshInflight: Promise<string | null> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError) => {
    const original = err.config as (typeof err.config & { _retried?: boolean }) | undefined;
    if (err.response?.status === 401 && original && !original._retried) {
      original._retried = true;
      const state = useAuth.getState();
      if (!state.refreshToken) {
        state.logout();
        return Promise.reject(err);
      }
      refreshInflight ??= state
        .refreshSession()
        .finally(() => {
          refreshInflight = null;
        });
      const newToken = await refreshInflight;
      if (!newToken) return Promise.reject(err);
      original.headers = original.headers ?? {};
      (original.headers as Record<string, string>).Authorization = `Bearer ${newToken}`;
      return api.request(original);
    }
    return Promise.reject(err);
  },
);

/** Pulls the user-facing message out of an axios error response. */
export function apiErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string } | undefined;
    return data?.message ?? err.message ?? fallback;
  }
  return fallback;
}
