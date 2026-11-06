import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyRequest } from "fastify";
import { getAddress, isAddress, isHex, recoverMessageAddress } from "viem";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { forbidden, HttpError, unauthorized } from "./errors.js";

export const SESSION_COOKIE = "pramaan_session";
export const CSRF_HEADER = "x-pramaan-csrf";
export const NONCE_TTL_MS = 10 * 60 * 1000;

export interface AuthUser {
  id: string;
  address: string | null;
  isAdmin: boolean;
  via: "session" | "token";
  /** Set for project-scoped API tokens: the token works for this project only. */
  tokenProjectId: string | null;
  sessionId: string | null;
  csrfToken: string | null;
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = (prefix: string) => `${prefix}_${randomBytes(32).toString("base64url")}`;

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function issueNonce(db: Db, now: Date): Promise<string> {
  const nonce = randomBytes(16).toString("hex");
  await db.query("INSERT INTO siwe_nonces (nonce, created_at) VALUES ($1, $2)", [nonce, now]);
  await db.query("DELETE FROM siwe_nonces WHERE created_at < $1", [new Date(now.getTime() - 24 * 3600_000)]);
  return nonce;
}

/**
 * Sign-In with Ethereum (EIP-4361) for externally owned accounts. The message must name an allowed domain and a
 * fresh, unused server nonce (10 minutes); the signature must recover to the message's address. A nonce is consumed
 * on first use whether or not the rest verifies. EIP-1271 smart-contract wallets are not supported (documented).
 */
export async function verifySiwe(db: Db, cfg: Config, message: string, signature: string, now: Date): Promise<{ userId: string; address: string; isAdmin: boolean }> {
  if (!isHex(signature) || signature.length < 132 || signature.length > 134) throw unauthorized("malformed signature", "SIWE_INVALID");
  let parsed: ReturnType<typeof parseSiweMessage>;
  try {
    parsed = parseSiweMessage(message);
  } catch {
    throw unauthorized("malformed SIWE message", "SIWE_INVALID");
  }
  if (!parsed.address || !isAddress(parsed.address, { strict: false }) || !parsed.domain || !parsed.nonce) throw unauthorized("malformed SIWE message", "SIWE_INVALID");
  if (!cfg.siweDomains.includes(parsed.domain)) throw unauthorized(`SIWE domain ${parsed.domain} is not allowed`, "SIWE_DOMAIN");
  if (parsed.uri) {
    try {
      if (new URL(parsed.uri).host !== parsed.domain) throw new Error("mismatch");
    } catch {
      throw unauthorized("SIWE uri does not match its domain", "SIWE_INVALID");
    }
  }
  const consumed = await db.one<{ created_at: Date }>("UPDATE siwe_nonces SET used_at = $2 WHERE nonce = $1 AND used_at IS NULL RETURNING created_at", [parsed.nonce, now]);
  if (!consumed) throw unauthorized("unknown or already used nonce", "SIWE_NONCE");
  if (now.getTime() - new Date(consumed.created_at).getTime() > NONCE_TTL_MS) throw unauthorized("nonce expired", "SIWE_NONCE");
  if (!validateSiweMessage({ message: parsed, domain: parsed.domain, nonce: parsed.nonce, time: now })) throw unauthorized("SIWE message is expired or not yet valid", "SIWE_INVALID");
  let recovered: string;
  try {
    recovered = await recoverMessageAddress({ message, signature: signature as `0x${string}` });
  } catch {
    throw unauthorized("signature could not be verified", "SIWE_SIGNATURE");
  }
  if (getAddress(recovered) !== getAddress(parsed.address)) throw unauthorized("signature does not match the address", "SIWE_SIGNATURE");
  const address = getAddress(parsed.address);
  const user = await db.one<{ id: string; is_admin: boolean }>(
    `INSERT INTO users (address, last_login_at) VALUES ($1, $2)
     ON CONFLICT (address) DO UPDATE SET last_login_at = $2 RETURNING id, is_admin`,
    [address, now],
  );
  return { userId: user!.id, address, isAdmin: user!.is_admin };
}

export async function createSession(db: Db, cfg: Config, userId: string, userAgent: string | undefined, now: Date): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
  const token = newToken("ses");
  const csrfToken = randomBytes(24).toString("base64url");
  const expiresAt = new Date(now.getTime() + cfg.SESSION_TTL_HOURS * 3600_000);
  await db.query("INSERT INTO sessions (user_id, token_hash, csrf_token, user_agent, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)", [
    userId,
    hashToken(token),
    csrfToken,
    (userAgent ?? "").slice(0, 200),
    now,
    expiresAt,
  ]);
  await db.query("DELETE FROM sessions WHERE expires_at < $1", [now]);
  return { token, csrfToken, expiresAt };
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE id = $1", [sessionId]);
}

export async function createApiToken(db: Db, userId: string, name: string, projectId: string | null): Promise<{ id: string; token: string }> {
  const token = newToken("pat");
  const row = await db.one<{ id: string }>("INSERT INTO api_tokens (user_id, project_id, name, token_hash) VALUES ($1, $2, $3, $4) RETURNING id", [userId, projectId, name, hashToken(token)]);
  return { id: row!.id, token };
}

/** Bearer API tokens ("pat_...") take precedence over the session cookie. Unknown credentials = signed out. */
export async function userFromRequest(db: Db, req: FastifyRequest, now: Date): Promise<AuthUser | null> {
  const auth = req.headers.authorization;
  if (auth !== undefined) {
    const m = /^Bearer\s+(pat_[A-Za-z0-9_-]{20,100})$/.exec(auth.trim());
    if (!m) return null;
    const row = await db.one<{ id: string; address: string | null; is_admin: boolean; project_id: string | null }>(
      `UPDATE api_tokens t SET last_used_at = $2 FROM users u
       WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND u.id = t.user_id
       RETURNING u.id, u.address, u.is_admin, t.project_id`,
      [hashToken(m[1]!), now],
    );
    return row ? { id: row.id, address: row.address, isAdmin: row.is_admin, via: "token", tokenProjectId: row.project_id, sessionId: null, csrfToken: null } : null;
  }
  const cookie = req.cookies?.[SESSION_COOKIE];
  if (!cookie || !/^ses_[A-Za-z0-9_-]{20,100}$/.test(cookie)) return null;
  const row = await db.one<{ id: string; address: string | null; is_admin: boolean; session_id: string; csrf_token: string }>(
    `SELECT u.id, u.address, u.is_admin, s.id AS session_id, s.csrf_token FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > $2`,
    [hashToken(cookie), now],
  );
  return row ? { id: row.id, address: row.address, isAdmin: row.is_admin, via: "session", tokenProjectId: null, sessionId: row.session_id, csrfToken: row.csrf_token } : null;
}

export function requireUser(user: AuthUser | null): AuthUser {
  if (!user) throw unauthorized();
  return user;
}

/** Account-level actions (tokens, new projects) are not allowed with a project-scoped token. */
export function requireAccountLevel(user: AuthUser | null): AuthUser {
  const u = requireUser(user);
  if (u.tokenProjectId) throw forbidden("a project-scoped token cannot do this", "TOKEN_SCOPE");
  return u;
}

export type Role = "owner" | "maintainer" | "viewer";
const RANK: Record<Role, number> = { viewer: 1, maintainer: 2, owner: 3 };

/** Project access: membership role; demo projects are readable by every signed-in user; admins act as owners. */
export async function projectRole(db: Db, user: AuthUser, projectId: string): Promise<Role | null> {
  if (user.tokenProjectId && user.tokenProjectId !== projectId) return null;
  if (user.isAdmin) return "owner";
  const m = await db.one<{ role: Role }>("SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2", [projectId, user.id]);
  if (m) return m.role;
  const demo = await db.one<{ is_demo: boolean }>("SELECT is_demo FROM projects WHERE id = $1", [projectId]);
  return demo?.is_demo ? "viewer" : null;
}

export async function assertRole(db: Db, user: AuthUser | null, projectId: string, min: Role): Promise<Role> {
  const u = requireUser(user);
  const exists = await db.one("SELECT 1 AS x FROM projects WHERE id = $1", [projectId]);
  if (!exists) throw new HttpError(404, "NOT_FOUND", "project not found");
  const role = await projectRole(db, u, projectId);
  if (!role) throw forbidden("no access to this project");
  if (RANK[role] < RANK[min]) throw forbidden(`requires the ${min} role on this project`, "ROLE_REQUIRED");
  return role;
}

/**
 * First start: create the admin user and a one-time API token. Only the hash is stored. Outside production the token
 * is written to DATA_DIR/admin-token.txt (mode 0600). In production ADMIN_ADDRESS is required and no token is minted.
 */
export async function bootstrapAdmin(db: Db, cfg: Config, log: (msg: string) => void): Promise<{ created: boolean; tokenFile: string | null }> {
  const file = join(cfg.DATA_DIR, "admin-token.txt");
  const existing = await db.one("SELECT id FROM users WHERE is_admin = true LIMIT 1");
  if (existing) return { created: false, tokenFile: existsSync(file) ? file : null };
  if (cfg.ADMIN_ADDRESS) {
    // Explicit admin wallet: no token is minted; the operator signs in with SIWE from this address.
    if (!isAddress(cfg.ADMIN_ADDRESS, { strict: false })) throw new Error("ADMIN_ADDRESS is not a valid Ethereum address");
    await db.query("INSERT INTO users (address, display_name, is_admin) VALUES ($1, 'admin', true) ON CONFLICT (address) DO UPDATE SET is_admin = true", [getAddress(cfg.ADMIN_ADDRESS)]);
    log(`admin wallet bootstrapped: ${getAddress(cfg.ADMIN_ADDRESS)}`);
    return { created: true, tokenFile: null };
  }
  if (cfg.production) {
    // Production without ADMIN_ADDRESS: refuse to create an admin whose credential nobody can retrieve.
    throw new Error("production first start requires ADMIN_ADDRESS (the wallet that becomes the first admin)");
  }
  const user = await db.one<{ id: string }>("INSERT INTO users (display_name, is_admin) VALUES ('admin', true) RETURNING id");
  const { token } = await createApiToken(db, user!.id, "bootstrap admin token", null);
  mkdirSync(cfg.DATA_DIR, { recursive: true });
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows ignores POSIX modes
  }
  return { created: true, tokenFile: file };
}

export async function audit(db: Db, userId: string | null, projectId: string | null, action: string, target: string | null, detail: Record<string, unknown> = {}): Promise<void> {
  await db.query("INSERT INTO audit_log (user_id, project_id, action, target, detail) VALUES ($1, $2, $3, $4, $5)", [userId, projectId, action, target, JSON.stringify(detail)]);
}
import "@fastify/cookie";
