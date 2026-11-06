import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { REPO_ROOT } from "@pramaan/release";

const flag = (def: "0" | "1") => z.enum(["0", "1", "true", "false"]).default(def).transform((v) => v === "1" || v === "true");
const optionalSecret = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

/**
 * Every setting comes from the environment. Secrets have no defaults: a feature whose secret is missing is reported as
 * disabled by GET /v1/config and its endpoints answer 501 with the reason.
 */
const Env = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().default("127.0.0.1"),
  /** Dashboard origins allowed to call the API with credentials (comma separated). */
  WEB_ORIGINS: z.string().default("http://localhost:5173,http://127.0.0.1:5173"),
  /** SIWE: the domains (host[:port]) a sign-in message may name - the dashboard host. */
  SIWE_DOMAINS: z.string().default("localhost:5173,127.0.0.1:5173"),
  /** postgres://... for production; unset = embedded PGlite in DATA_DIR/pglite. */
  DATABASE_URL: optionalSecret,
  DATA_DIR: z.string().default(".pramaan/server"),
  /** Wallet address that becomes the first admin (sign in with SIWE). Preferred over a token in production. */
  ADMIN_ADDRESS: optionalSecret,
  /** Run the job worker and chain monitor inside the API process (required with PGlite). */
  EMBEDDED_WORKER: flag("1"),
  TRUST_PROXY: flag("0"),
  SESSION_TTL_HOURS: z.coerce.number().positive().max(24 * 90).default(168),
  COOKIE_SECURE: flag("0"),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(500).default(50),
  /** Limits for an uploaded archive once expanded. */
  MAX_ARCHIVE_ENTRIES: z.coerce.number().int().positive().default(20_000),
  MAX_ARCHIVE_EXPANDED_MB: z.coerce.number().positive().default(300),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_INGEST_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_UPLOAD_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_PUBLIC_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  GITHUB_WEBHOOK_SECRET: optionalSecret,
  GITHUB_TOKEN: optionalSecret,
  GITHUB_API_URL: z.string().default("https://api.github.com"),
  CRE_INGEST_SECRET: optionalSecret,
  TELEGRAM_BOT_TOKEN: optionalSecret,
  TELEGRAM_CHAT_ID: optionalSecret,
  TELEGRAM_API_URL: z.string().default("https://api.telegram.org"),
  IPFS_API_URL: optionalSecret,
  IPFS_GATEWAY_URL: optionalSecret,
  PINATA_JWT: optionalSecret,
  /** Least-privilege TESTNET key: only the PramaanTimelock proposer role. Used to queue/execute pointers. */
  PROPOSER_PRIVATE_KEY: optionalSecret,

  /**
   * RPCs for POST /v1/verify/site, e.g. "11155111=https://a.example,https://b.example;31337=http://127.0.0.1:8545".
   * The imported demo network is added automatically.
   */
  VERIFY_RPC_URLS: z.string().default(""),
  /** Allow server-side fetches (verify-site, monitor RPCs) to private/loopback addresses. Defaults to on outside production. */
  ALLOW_PRIVATE_NETWORK: z.enum(["0", "1", "true", "false", ""]).default(""),

  MONITOR_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
  /** A log is processed once its block has this many confirmations (1 = the latest block counts). */
  MONITOR_CONFIRMATIONS: z.coerce.number().int().min(0).max(1000).default(1),
  MONITOR_MAX_RANGE: z.coerce.number().int().positive().max(100_000).default(2_000),
  MONITOR_MAX_CHUNKS: z.coerce.number().int().positive().max(100).default(5),
  /** Where a new monitor starts when it has no start block: this many blocks behind the head. */
  MONITOR_LOOKBACK_BLOCKS: z.coerce.number().int().min(0).default(5_000),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(1_500),
  WORKER_HEARTBEAT_MS: z.coerce.number().int().positive().default(2_000),
  SSE_POLL_MS: z.coerce.number().int().positive().default(1_000),
  SSE_HEARTBEAT_MS: z.coerce.number().int().positive().default(15_000),

  DEMO_AUTOIMPORT: flag("1"),
  /** Overrides the demo state file (default .pramaan/demo/state.json, or PRAMAAN_DEMO_STATE). */
  DEMO_STATE_PATH: optionalSecret,
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  NODE_ENV: z.string().default("development"),
});

export type Config = Omit<z.infer<typeof Env>, "ALLOW_PRIVATE_NETWORK"> & {
  webOrigins: string[];
  siweDomains: string[];
  allowPrivateNetwork: boolean;
  production: boolean;
  verifyRpcUrls: Record<number, string[]>;
};

export function parseRpcList(value: string): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  for (const part of value.split(";").map((s) => s.trim()).filter(Boolean)) {
    const eq = part.indexOf("=");
    if (eq <= 0) throw new Error(`VERIFY_RPC_URLS entry "${part}" must look like <chainId>=<url>[,<url>]`);
    const chainId = Number(part.slice(0, eq));
    if (!Number.isInteger(chainId) || chainId <= 0) throw new Error(`VERIFY_RPC_URLS: invalid chain id in "${part}"`);
    const urls = part
      .slice(eq + 1)
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);
    for (const u of urls) if (!/^https?:\/\//.test(u)) throw new Error(`VERIFY_RPC_URLS: ${u} is not an http(s) URL`);
    out[chainId] = urls;
  }
  return out;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`invalid configuration: ${issue?.path.join(".")}: ${issue?.message}`);
  }
  const c = parsed.data;
  const production = c.NODE_ENV === "production";
  const { ALLOW_PRIVATE_NETWORK, ...rest } = c;
  return {
    ...rest,
    DATA_DIR: isAbsolute(c.DATA_DIR) ? c.DATA_DIR : resolve(REPO_ROOT, c.DATA_DIR),
    webOrigins: c.WEB_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    siweDomains: c.SIWE_DOMAINS.split(",").map((s) => s.trim()).filter(Boolean),
    allowPrivateNetwork: ALLOW_PRIVATE_NETWORK === "" ? !production : ALLOW_PRIVATE_NETWORK === "1" || ALLOW_PRIVATE_NETWORK === "true",
    production,
    verifyRpcUrls: parseRpcList(c.VERIFY_RPC_URLS),
  };
}

/** Public capability flags (booleans only) so the dashboard can disable what this server cannot do. */
export function capabilities(cfg: Config, aiAvailable: boolean) {
  return {
    telegram: Boolean(cfg.TELEGRAM_BOT_TOKEN && cfg.TELEGRAM_CHAT_ID),
    ipfs: Boolean(cfg.IPFS_API_URL || cfg.PINATA_JWT),
    github: Boolean(cfg.GITHUB_TOKEN),
    githubWebhook: Boolean(cfg.GITHUB_WEBHOOK_SECRET),
    proposer: Boolean(cfg.PROPOSER_PRIVATE_KEY),
    ai: aiAvailable,
    cre: Boolean(cfg.CRE_INGEST_SECRET),
  };
}
