import { describe, expect, it } from "vitest";
import { bootstrapAdmin } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";

const ADMIN = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

describe("bootstrapAdmin", () => {
  it("creates a wallet admin from ADMIN_ADDRESS without minting or logging a token", async () => {
    const db = await openDb({ memory: true });
    const cfg = loadConfig({ DATA_DIR: ".pramaan/test-bootstrap", NODE_ENV: "production", ADMIN_ADDRESS: ADMIN.toLowerCase() });
    const logs: string[] = [];
    const res = await bootstrapAdmin(db, cfg, (m) => logs.push(m));
    expect(res).toEqual({ created: true, tokenFile: null });
    const admin = await db.one<{ address: string; is_admin: boolean }>("SELECT address, is_admin FROM users WHERE is_admin = true");
    expect(admin?.address).toBe(ADMIN);
    const tokens = await db.one<{ n: string }>("SELECT count(*)::text AS n FROM api_tokens");
    expect(tokens?.n).toBe("0");
    expect(logs.join("\n")).not.toMatch(/token/i);
    expect((await bootstrapAdmin(db, cfg, () => undefined)).created).toBe(false);
  });

  it("refuses an unretrievable admin credential in production without ADMIN_ADDRESS", async () => {
    const db = await openDb({ memory: true });
    const cfg = loadConfig({ DATA_DIR: ".pramaan/test-bootstrap", NODE_ENV: "production" });
    await expect(bootstrapAdmin(db, cfg, () => undefined)).rejects.toThrow(/ADMIN_ADDRESS/);
    expect(await db.one("SELECT 1 FROM users")).toBeFalsy();
  });
});
