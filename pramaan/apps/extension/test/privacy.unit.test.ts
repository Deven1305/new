import { describe, expect, it } from "vitest";
import { matchBody, matchHeaders, matchUrl } from "../src/shared/leaks.js";
import { decide, timeoutRow } from "../src/shared/policy.js";

const account = "0x1234567890123456789012345678901234567890";
describe("privacy observation and signing policy", () => {
  it("finds the same account in URLs, raw JSON, forms and headers", () => {
    expect(matchUrl(`https://tracker.example/?wallet=${account}`, [account])?.where).toContain("query");
    const bytes = new TextEncoder().encode(JSON.stringify({ wallet: account }));
    expect(matchBody({ raw: [{ bytes: bytes.buffer }] }, [account])?.where).toContain("wallet");
    expect(matchBody({ formData: { wallet: [account] } }, [account])?.account).toBe(account);
    expect(matchHeaders([{ name: "X-Wallet", value: account }], [account])?.where).toContain("X-Wallet");
    expect(matchUrl("https://tracker.example/?wallet=none", [account])).toBeNull();
  });
  it("holds signing when verification times out or a verification row is red", () => {
    const assessment = { level: "low" as const, findings: [] };
    expect(decide([timeoutRow(30000)], assessment, { timedOut: true })).toMatchObject({ blocked: true, reasons: ["verification-unknown"] });
    expect(decide([{ ...timeoutRow(0), color: "red" }], assessment).blocked).toBe(true);
  });
});
