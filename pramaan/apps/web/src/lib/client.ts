import { ApiClient, type AuthMaterial } from "./api";
import { API_BASE_URL } from "./config";
import type { MeResponse } from "./types";

/**
 * Where auth material lives:
 *  - API token (paste mode): sessionStorage only, so it dies with the tab and is never written to localStorage.
 *  - CSRF token (cookie sessions): memory only; it is re-read from GET /v1/me after a reload.
 * The session cookie itself is httpOnly and never visible to this code.
 */
export const TOKEN_STORAGE_KEY = "pramaan.apiToken";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface AuthStore {
  getBearer(): string | null;
  setBearer(token: string | null): void;
  getCsrf(): string | null;
  setCsrf(token: string | null): void;
  material(): AuthMaterial;
  subscribe(listener: () => void): () => void;
  /** Snapshot used by useSyncExternalStore (changes whenever the bearer or the csrf token changes). */
  version(): number;
}

export function createAuthStore(getStorage: () => StorageLike | null = defaultSessionStorage): AuthStore {
  let csrf: string | null = null;
  let bearerCache: string | null | undefined;
  let version = 0;
  const listeners = new Set<() => void>();
  const emit = () => {
    version++;
    listeners.forEach((l) => l());
  };
  const read = (): string | null => {
    try {
      return getStorage()?.getItem(TOKEN_STORAGE_KEY) || null;
    } catch {
      return null;
    }
  };
  return {
    getBearer() {
      if (bearerCache === undefined) bearerCache = read();
      return bearerCache;
    },
    setBearer(token) {
      const clean = token?.trim() || null;
      bearerCache = clean;
      try {
        const s = getStorage();
        if (s) {
          if (clean) s.setItem(TOKEN_STORAGE_KEY, clean);
          else s.removeItem(TOKEN_STORAGE_KEY);
        }
      } catch {
        // sessionStorage can be unavailable (private mode); the token then lives in memory for this page only.
      }
      emit();
    },
    getCsrf: () => csrf,
    setCsrf(token) {
      if (token === csrf) return;
      csrf = token;
      emit();
    },
    material() {
      if (bearerCache === undefined) bearerCache = read();
      return { bearer: bearerCache, csrf };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    version: () => version,
  };
}

function defaultSessionStorage(): StorageLike | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export const authStore = createAuthStore();

export const api: ApiClient = new ApiClient({
  baseUrl: API_BASE_URL,
  auth: () => authStore.material(),
  refreshCsrf: async () => {
    const me = await api.get<MeResponse>("/v1/me");
    authStore.setCsrf(me.csrfToken ?? null);
    return me.csrfToken ?? null;
  },
});
