import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { isApiError } from "./api";
import { api, authStore } from "./client";
import type { BackendConfig, MeResponse, Readiness } from "./types";

export function useAuthVersion(): number {
  return useSyncExternalStore(authStore.subscribe, authStore.version, authStore.version);
}

/** Retry only transient server trouble; never retry auth, validation, 404 or unreachable (the UI offers a Retry button). */
export function retryPolicy(failureCount: number, err: unknown): boolean {
  return failureCount < 1 && isApiError(err) && err.kind === "server";
}

export interface GetOptions {
  query?: Record<string, string | number | boolean | null | undefined>;
  enabled?: boolean;
  refetchInterval?: number | false;
  staleTime?: number;
}

export function useGet<T>(key: readonly unknown[], path: string, opts: GetOptions = {}): UseQueryResult<T, Error> {
  const authVersion = useAuthMode();
  return useQuery<T, Error>({
    queryKey: [...key, authVersion],
    queryFn: ({ signal }) => api.get<T>(path, { query: opts.query, signal }),
    enabled: opts.enabled ?? true,
    refetchInterval: opts.refetchInterval ?? false,
    staleTime: opts.staleTime ?? 5_000,
    retry: retryPolicy,
  });
}

/** Bearer-or-cookie marker used in query keys so data refetches after signing in or out. */
export function useAuthMode(): string {
  useAuthVersion();
  return authStore.getBearer() ? "token" : "cookie";
}

export function useMe(): UseQueryResult<MeResponse, Error> {
  const mode = useAuthMode();
  return useQuery<MeResponse, Error>({
    queryKey: ["me", mode],
    queryFn: async ({ signal }) => {
      const me = await api.get<MeResponse>("/v1/me", { signal });
      authStore.setCsrf(me.csrfToken ?? null);
      return me;
    },
    retry: retryPolicy,
    staleTime: 60_000,
  });
}

export function useConfig(): UseQueryResult<BackendConfig, Error> {
  return useGet<BackendConfig>(["config"], "/v1/config", { staleTime: 60_000 });
}

/** A reachable backend answering 503 with a readiness body is degraded, not offline; only transport failures stay errors. */
export function readinessFromError(err: unknown): Readiness | null {
  if (!isApiError(err) || err.status !== 503) return null;
  const b = err.body as Partial<Readiness> | null | undefined;
  if (!b || typeof b !== "object" || typeof b.ok !== "boolean") return null;
  return { ...(b as Readiness), ok: false };
}

export function useReadiness(): UseQueryResult<Readiness, Error> {
  const authVersion = useAuthMode();
  return useQuery<Readiness, Error>({
    queryKey: ["readyz", authVersion],
    queryFn: async ({ signal }) => {
      try {
        return await api.get<Readiness>("/readyz", { signal });
      } catch (err) {
        const degraded = readinessFromError(err);
        if (degraded) return degraded;
        throw err;
      }
    },
    staleTime: 15_000,
    retry: retryPolicy,
  });
}

/** Reasons shown next to actions the backend cannot perform with its current configuration. */
export const UNSUPPORTED_REASON: Record<keyof BackendConfig, string> = {
  telegram: "Telegram is not configured on this backend (TELEGRAM_BOT_TOKEN and chat id).",
  ipfs: "IPFS pinning is not configured on this backend (IPFS_API_URL or PINATA_JWT).",
  github: "Pull requests are disabled: this backend has no GITHUB_TOKEN.",
  proposer: "No timelock proposer key is configured on this backend (PROPOSER_PRIVATE_KEY; the pointer can still be queued with `pnpm pramaan publish queue`).",
  ai: "AI assistance is off: the backend has no ANTHROPIC_API_KEY.",
  cre: "Chainlink CRE ingest is not configured on this backend (CRE_INGEST_SECRET).",
};
