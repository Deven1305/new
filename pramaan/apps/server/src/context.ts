import { aiAvailable as engineAiAvailable, dockerStatus as engineDockerStatus, type DockerStatus } from "@pramaan/engine";
import { verifySiteRelease } from "@pramaan/verifier-core";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { AuthUser } from "./auth.js";

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser | null;
    rawBody?: Buffer | null;
  }
}

export interface LogLike {
  info: (o: unknown, m?: string) => void;
  warn: (o: unknown, m?: string) => void;
  error: (o: unknown, m?: string) => void;
}

/** Everything with a side effect on the outside world is injectable, so tests never touch the network or the clock. */
export interface Deps {
  now: () => Date;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  verifySite: typeof verifySiteRelease;
  dockerStatus: () => Promise<DockerStatus>;
  aiAvailable: () => boolean;
}

export type DepsInput = Partial<Deps> & { logStream?: NodeJS.WritableStream };

export function resolveDeps(input: DepsInput = {}): Deps {
  return {
    now: input.now ?? (() => new Date()),
    // late binding: a test that replaces globalThis.fetch sees every outbound call
    fetch: input.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args)),
    sleep: input.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))),
    verifySite: input.verifySite ?? verifySiteRelease,
    dockerStatus: input.dockerStatus ?? (() => engineDockerStatus()),
    aiAvailable: input.aiAvailable ?? engineAiAvailable,
  };
}

export interface Ctx {
  cfg: Config;
  db: Db;
  deps: Deps;
  log: LogLike;
}
