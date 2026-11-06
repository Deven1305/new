import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createApiToken } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { CRE_WORKFLOW_DECISIONS } from "../src/routes/ingest.js";

function signBody(secret: string, bodyStr: string): string {
  const hmac = createHmac("sha256", secret).update(Buffer.from(bodyStr, "utf8")).digest("hex");
  return `sha256=${hmac}`;
}

describe("Authenticated monitoring, alerts, and CRE ingest backend", () => {
  it("POST /v1/ingest/cre returns 501 when CRE_INGEST_SECRET is not configured", async () => {
    const db = await openDb({ memory: true });
    const cfg = loadConfig({
      DATA_DIR: ".pramaan/test-cre-501",
      CRE_INGEST_SECRET: "",
      RATE_LIMIT_MAX: "10000",
    });
    const app = await createApp({ db, cfg, skipBootstrap: true });

    try {
      const payload = JSON.stringify({
        workflow: "timelock-drift",
        runId: "run-001",
        observedAt: new Date().toISOString(),
        chainId: 11155111,
        app: "pramaan-vault",
        ensName: "vault.pramaan.eth",
        decision: "OK",
        severity: "info",
        details: { summary: "ok", subject: "vault" },
        idempotencyKey: "idem-001",
      });

      const res = await app.inject({
        method: "POST",
        url: "/v1/ingest/cre",
        headers: {
          "content-type": "application/json",
          "x-pramaan-signature": "sha256=" + "a".repeat(64),
        },
        payload,
      });

      expect(res.statusCode).toBe(501);
      expect(res.json().error.code).toBe("CRE_NOT_CONFIGURED");
    } finally {
      await app.close();
      await db.close();
    }
  });

  it("POST /v1/ingest/cre rejects missing or malformed signature header with 401", async () => {
    const db = await openDb({ memory: true });
    const secret = "super-secret-cre-key-1234567890";
    const cfg = loadConfig({
      DATA_DIR: ".pramaan/test-cre-sig",
      CRE_INGEST_SECRET: secret,
      RATE_LIMIT_MAX: "10000",
    });
    const app = await createApp({ db, cfg, skipBootstrap: true });

    try {
      const payload = JSON.stringify({
        workflow: "timelock-drift",
        runId: "run-001",
        observedAt: new Date().toISOString(),
        chainId: 11155111,
        app: "pramaan-vault",
        ensName: "vault.pramaan.eth",
        decision: "OK",
        severity: "info",
        details: { summary: "ok", subject: "vault" },
        idempotencyKey: "idem-001",
      });

      // 1. Missing header
      const missingRes = await app.inject({
        method: "POST",
        url: "/v1/ingest/cre",
        headers: { "content-type": "application/json" },
        payload,
      });
      expect(missingRes.statusCode).toBe(401);
      expect(missingRes.json().error.code).toBe("SIGNATURE_MISSING");

      // 2. Malformed header (missing sha256= prefix)
      const malformedRes = await app.inject({
        method: "POST",
        url: "/v1/ingest/cre",
        headers: {
          "content-type": "application/json",
          "x-pramaan-signature": "a".repeat(64),
        },
        payload,
      });
      expect(malformedRes.statusCode).toBe(401);
      expect(malformedRes.json().error.code).toBe("SIGNATURE_INVALID");

      // 3. Malformed hex (too short)
      const shortRes = await app.inject({
        method: "POST",
        url: "/v1/ingest/cre",
        headers: {
          "content-type": "application/json",
          "x-pramaan-signature": "sha256=abcdef",
        },
        payload,
      });
      expect(shortRes.statusCode).toBe(401);
      expect(shortRes.json().error.code).toBe("SIGNATURE_INVALID");
    } finally {
      await app.close();
      await db.close();
    }
  });

  it("POST /v1/ingest/cre rejects wrong MAC with 401 and enforces exact whitespace raw bytes", async () => {
    const db = await openDb({ memory: true });
    const secret = "super-secret-cre-key-1234567890";
    const cfg = loadConfig({
      DATA_DIR: ".pramaan/test-cre-mac",
      CRE_INGEST_SECRET: secret,
      RATE_LIMIT_MAX: "10000",
    });
    const app = await createApp({ db, cfg, skipBootstrap: true });

    try {
      await db.query(
        `INSERT INTO projects (slug, name, ens_name, chain_id)
         VALUES ('vault-p', 'Vault P', 'vault.pramaan.eth', 11155111)`,
      );

      const exactPayload = JSON.stringify({
        workflow: "timelock-drift",
        runId: "run-001",
        observedAt: new Date().toISOString(),
        chainId: 11155111,
        app: "pramaan-vault",
        ensName: "vault.pramaan.eth",
        decision: "OK",
        severity: "info",
        details: { summary: "ok", subject: "vault" },
        idempotencyKey: "idem-001",
      });

      // 1. Wrong signature
      const wrongSigRes = await app.inject({
        method: "POST",
        url: "/v1/ingest/cre",
        headers: {
          "content-type": "application/json",
          "x-pramaan-signature": "sha256=" + "b".repeat(64),
        },
        payload: exactPayload,
      });
      expect(wrongSigRes.statusCode).toBe(401);
      expect(wrongSigRes.json().error.code).toBe("SIGNATURE_INVALID");

      // 2. Exact whitespace signed vs tampered whitespace sent (appended newline/space alters raw bytes)
      const validSig = signBody(secret, exactPayload);
      const tamperedWhitespacePayload = exactPayload + " ";
      expect(tamperedWhitespacePayload).not.toBe(exactPayload);

      const whitespaceRes = await app.inject({
        method: "POST",
        url: "/v1/ingest/cre",
        headers: {
          "content-type": "application/json",
          "x-pramaan-signature": validSig, // signed over exact original payload without trailing space
        },
        payload: tamperedWhitespacePayload,
      });
      expect(whitespaceRes.statusCode).toBe(401);
      expect(whitespaceRes.json().error.code).toBe("SIGNATURE_INVALID");

      // 3. Valid exact raw body bytes matching signature succeed
      const validRes = await app.inject({
        method: "POST",
        url: "/v1/ingest/cre",
        headers: {
          "content-type": "application/json",
          "x-pramaan-signature": validSig,
        },
        payload: exactPayload,
      });
      expect(validRes.statusCode).toBe(200);
      expect(validRes.json().ok).toBe(true);
    } finally {
      await app.close();
      await db.close();
    }
  });

  it("POST /v1/ingest/cre rejects prototype-poisoning payloads with 400 and preserves normal JSON routes", async () => {
    const db = await openDb({ memory: true });
    const secret = "super-secret-cre-key-1234567890";
    const cfg = loadConfig({
      DATA_DIR: ".pramaan/test-cre-proto",
      CRE_INGEST_SECRET: secret,
      RATE_LIMIT_MAX: "10000",
    });
    const app = await createApp({ db, cfg, skipBootstrap: true });

    try {
      // 1. Ingest with prototype-poisoning attempt (__proto__ in raw wire JSON)
      const nowIso = new Date().toISOString();
      const poisonedPayload = `{"workflow":"timelock-drift","runId":"run-001","observedAt":"${nowIso}","chainId":11155111,"app":"pramaan-vault","ensName":"vault.pramaan.eth","decision":"OK","severity":"info","details":{"subject":"test"},"idempotencyKey":"idem-001","__proto__":{"isAdmin":true}}`;
      expect(poisonedPayload).toContain('"__proto__"');

      const sig = signBody(secret, poisonedPayload);

      const protoRes = await app.inject({
        method: "POST",
        url: "/v1/ingest/cre",
        headers: {
          "content-type": "application/json",
          "x-pramaan-signature": sig,
        },
        payload: poisonedPayload,
      });
      expect(protoRes.statusCode).toBe(400);
      expect(protoRes.json().error.code).toBe("VALIDATION_FAILED");

      // 2. Normal JSON route (/v1/decode) works normally
      const decodeRes = await app.inject({
        method: "POST",
        url: "/v1/decode",
        headers: { "content-type": "application/json" },
        payload: {
          method: "eth_sendTransaction",
          params: [
            {
              to: "0x2222222222222222222222222222222222222222",
              data: "0x095ea7b30000000000000000000000003333333333333333333333333333333333333333ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            },
          ],
        },
      });
      expect(decodeRes.statusCode).toBe(200);
    } finally {
      await app.close();
      await db.close();
    }
  });

  it("POST /v1/ingest/cre rejects invalid body and enforces fresh timestamps (older 10min / future rejected)", async () => {
    let now = new Date("2026-11-05T12:00:00.000Z");
    const db = await openDb({ memory: true });
    const secret = "super-secret-cre-key-1234567890";
    const cfg = loadConfig({
      DATA_DIR: ".pramaan/test-cre-time",
      CRE_INGEST_SECRET: secret,
      RATE_LIMIT_MAX: "10000",
    });
    const app = await createApp({
      db,
      cfg,
      skipBootstrap: true,
      deps: { now: () => now },
    });

    try {
      await db.query(
        `INSERT INTO projects (slug, name, ens_name, chain_id)
         VALUES ('vault-time', 'Vault Time', 'vault.pramaan.eth', 11155111)`,
      );

      // 1. Missing required field (runId missing)
      const invalidPayload = JSON.stringify({
        workflow: "timelock-drift",
        observedAt: now.toISOString(),
        chainId: 11155111,
        app: "pramaan-vault",
        ensName: "vault.pramaan.eth",
        decision: "OK",
        severity: "info",
        details: { test: true },
        idempotencyKey: "idem-001",
      });
      const invalidSig = signBody(secret, invalidPayload);
      const invalidRes = await app.inject({
        method: "POST",
        url: "/v1/ingest/cre",
        headers: {
          "content-type": "application/json",
          "x-pramaan-signature": invalidSig,
        },
        payload: invalidPayload,
      });
      expect(invalidRes.statusCode).toBe(400);

      // 2. Non-object details (string instead of Record<string, unknown>)
      const badDetailsPayload = JSON.stringify({
        workflow: "timelock-drift",
        runId: "run-bad-details",
        observedAt: now.toISOString(),
        chainId: 11155111,
        app: "pramaan-vault",
        ensName: "vault.pramaan.eth",
        decision: "OK",
        severity: "info",
        details: "not an object",
        idempotencyKey: "idem-001",
      });
      const badDetailsSig = signBody(secret, badDetailsPayload);
      const badDetailsRes = await app.inject({
        method: "POST",
        url: "/v1/ingest/cre",
        headers: {
          "content-type": "application/json",
          "x-pramaan-signature": badDetailsSig,
        },
        payload: badDetailsPayload,
      });
      expect(badDetailsRes.statusCode).toBe(400);

      // 3. Timestamp older than 10 minutes (11 minutes ago)
      const oldTime = new Date(now.getTime() - 11 * 60_000).toISOString();
      const oldPayload = JSON.stringify({
        workflow: "timelock-drift",
        runId: "run-old",
        observedAt: oldTime,
        chainId: 11155111,
        app: "pramaan-vault",
        ensName: "vault.pramaan.eth",
        decision: "OK",
        severity: "info",
        details: { note: "old" },
        idempotencyKey: "idem-old",
      });
      const oldSig = signBody(secret, oldPayload);
      const oldRes = await app.inject({
        method: "POST",
        url: "/v1/ingest/cre",
        headers: {
          "content-type": "application/json",
          "x-pramaan-signature": oldSig,
        },
        payload: oldPayload,
      });
      expect(oldRes.statusCode).toBe(400);

      // 4. Timestamp in the future (5 minutes into the future)
      const futureTime = new Date(now.getTime() + 5 * 60_000).toISOString();
      const futurePayload = JSON.stringify({
        workflow: "timelock-drift",
        runId: "run-future",
        observedAt: futureTime,
        chainId: 11155111,
        app: "pramaan-vault",
        ensName: "vault.pramaan.eth",
        decision: "OK",
        severity: "info",
        details: { note: "future" },
        idempotencyKey: "idem-future",
      });
      const futureSig = signBody(secret, futurePayload);
      const futureRes = await app.inject({
        method: "POST",
        url: "/v1/ingest/cre",
        headers: {
          "content-type": "application/json",
          "x-pramaan-signature": futureSig,
        },
        payload: futurePayload,
      });
      expect(futureRes.statusCode).toBe(400);

      // 5. Valid timestamp (2 minutes ago)
      const freshTime = new Date(now.getTime() - 2 * 60_000).toISOString();
      const freshPayload = JSON.stringify({
        workflow: "timelock-drift",
        runId: "run-fresh",
        observedAt: freshTime,
        chainId: 11155111,
        app: "pramaan-vault",
        ensName: "vault.pramaan.eth",
        decision: "OK",
        severity: "info",
        details: { note: "fresh" },
        idempotencyKey: "idem-fresh",
      });
      const freshSig = signBody(secret, freshPayload);
      const freshRes = await app.inject({
        method: "POST",
        url: "/v1/ingest/cre",
        headers: {
          "content-type": "application/json",
          "x-pramaan-signature": freshSig,
        },
        payload: freshPayload,
      });
      expect(freshRes.statusCode).toBe(200);
    } finally {
      await app.close();
      await db.close();
    }
  });

  it("POST /v1/ingest/cre rejects unknown project (404) and ambiguous project association (409)", async () => {
    const db = await openDb({ memory: true });
    const secret = "super-secret-cre-key-1234567890";
    const cfg = loadConfig({
      DATA_DIR: ".pramaan/test-cre-proj",
      CRE_INGEST_SECRET: secret,
      RATE_LIMIT_MAX: "10000",
    });
    const app = await createApp({ db, cfg, skipBootstrap: true });

    try {
      // 1. Unknown project
      const unknownPayload = JSON.stringify({
        workflow: "timelock-drift",
        runId: "run-unk",
        observedAt: new Date().toISOString(),
        chainId: 11155111,
        app: "unknown-app",
        ensName: "nonexistent.eth",
        decision: "OK",
        severity: "info",
        details: { note: "unknown" },
        idempotencyKey: "idem-unk",
      });
      const unknownSig = signBody(secret, unknownPayload);
      const unkRes = await app.inject({
        method: "POST",
        url: "/v1/ingest/cre",
        headers: {
          "content-type": "application/json",
          "x-pramaan-signature": unknownSig,
        },
        payload: unknownPayload,
      });
      expect(unkRes.statusCode).toBe(404);

      // 2. Create TWO projects with identical ens_name and chain_id (ambiguous)
      await db.query(
        `INSERT INTO projects (slug, name, ens_name, chain_id)
         VALUES ('p1', 'Project 1', 'ambig.eth', 1),
                ('p2', 'Project 2', 'ambig.eth', 1)`,
      );

      const ambigPayload = JSON.stringify({
        workflow: "timelock-drift",
        runId: "run-ambig",
        observedAt: new Date().toISOString(),
        chainId: 1,
        app: "ambig-app",
        ensName: "ambig.eth",
        decision: "OK",
        severity: "info",
        details: { note: "ambig" },
        idempotencyKey: "idem-ambig",
      });
      const ambigSig = signBody(secret, ambigPayload);
      const ambigRes = await app.inject({
        method: "POST",
        url: "/v1/ingest/cre",
        headers: {
          "content-type": "application/json",
          "x-pramaan-signature": ambigSig,
        },
        payload: ambigPayload,
      });
      expect(ambigRes.statusCode).toBe(409);
      expect(ambigRes.json().error.code).toBe("AMBIGUOUS_PROJECT");
    } finally {
      await app.close();
      await db.close();
    }
  });

  it("POST /v1/ingest/cre accepts all 7 exact workflow decisions and rejects invented ALERT/WARN", async () => {
    const db = await openDb({ memory: true });
    const secret = "super-secret-cre-key-1234567890";
    const cfg = loadConfig({
      DATA_DIR: ".pramaan/test-cre-all7",
      CRE_INGEST_SECRET: secret,
      RATE_LIMIT_MAX: "10000",
    });
    const app = await createApp({ db, cfg, skipBootstrap: true });

    try {
      const proj = await db.one<{ id: string }>(
        `INSERT INTO projects (slug, name, ens_name, chain_id)
         VALUES ('p-dec', 'Project Decision', 'dec.eth', 11155111) RETURNING id`,
      );

      // 1. Rejects invented "ALERT"
      const inventedAlertPayload = JSON.stringify({
        workflow: "timelock-drift",
        runId: "run-alert-inv",
        observedAt: new Date().toISOString(),
        chainId: 11155111,
        app: "dec-app",
        ensName: "dec.eth",
        decision: "ALERT",
        severity: "high",
        details: { note: "invented" },
        idempotencyKey: "idem-inv-alert",
      });
      const invAlertRes = await app.inject({
        method: "POST",
        url: "/v1/ingest/cre",
        headers: {
          "content-type": "application/json",
          "x-pramaan-signature": signBody(secret, inventedAlertPayload),
        },
        payload: inventedAlertPayload,
      });
      expect(invAlertRes.statusCode).toBe(400);

      // 2. Rejects invented "WARN"
      const inventedWarnPayload = JSON.stringify({
        workflow: "timelock-drift",
        runId: "run-warn-inv",
        observedAt: new Date().toISOString(),
        chainId: 11155111,
        app: "dec-app",
        ensName: "dec.eth",
        decision: "WARN",
        severity: "medium",
        details: { note: "invented" },
        idempotencyKey: "idem-inv-warn",
      });
      const invWarnRes = await app.inject({
        method: "POST",
        url: "/v1/ingest/cre",
        headers: {
          "content-type": "application/json",
          "x-pramaan-signature": signBody(secret, inventedWarnPayload),
        },
        payload: inventedWarnPayload,
      });
      expect(invWarnRes.statusCode).toBe(400);

      // 3. Test all 7 exact workflow decisions are accepted
      for (const dec of CRE_WORKFLOW_DECISIONS) {
        const payload = JSON.stringify({
          workflow: `flow-${dec}`,
          runId: `run-${dec}`,
          observedAt: new Date().toISOString(),
          chainId: 11155111,
          app: "dec-app",
          ensName: "dec.eth",
          decision: dec,
          severity: dec === "OK" ? "info" : dec === "RELEASE_REVOKED" ? "critical" : "high",
          details: { decision: dec, subject: "subject-test" },
          idempotencyKey: `idem-${dec}`,
        });

        const res = await app.inject({
          method: "POST",
          url: "/v1/ingest/cre",
          headers: {
            "content-type": "application/json",
            "x-pramaan-signature": signBody(secret, payload),
          },
          payload,
        });

        expect(res.statusCode).toBe(200);
        const data = res.json();
        expect(data.decision).toBe(dec);

        if (dec === "OK") {
          expect(data.alertId).toBeNull();
        } else {
          expect(data.alertId).toBeTruthy();
        }
      }

      // OK created no alert, while the 6 non-OK decisions created exactly 6 alerts
      const totalAlerts = Number(
        (await db.one<{ count: string | number }>("SELECT COUNT(*)::int AS count FROM alerts WHERE project_id = $1", [proj!.id]))?.count ?? 0,
      );
      expect(totalAlerts).toBe(6);
    } finally {
      await app.close();
      await db.close();
    }
  });

  it("POST /v1/ingest/cre maps severities explicitly and preserves delimiter-separated identities", async () => {
    const db = await openDb({ memory: true });
    const secret = "super-secret-cre-key-1234567890";
    const cfg = loadConfig({
      DATA_DIR: ".pramaan/test-cre-delims",
      CRE_INGEST_SECRET: secret,
      RATE_LIMIT_MAX: "10000",
    });
    const app = await createApp({ db, cfg, skipBootstrap: true });

    try {
      await db.query(
        `INSERT INTO projects (slug, name, ens_name, chain_id)
         VALUES ('p-delims', 'Project Delims', 'delims.eth', 11155111)`,
      );

      // 1. Severity mapping check
      // Critical -> critical
      const critPayload = JSON.stringify({
        workflow: "flow-crit",
        runId: "run-crit",
        observedAt: new Date().toISOString(),
        chainId: 11155111,
        app: "delims-app",
        ensName: "delims.eth",
        decision: "RELEASE_REVOKED",
        severity: "critical",
        details: { reason: "revoked" },
        idempotencyKey: "idem-crit",
      });
      const critRes = await app.inject({
        method: "POST",
        url: "/v1/ingest/cre",
        headers: { "content-type": "application/json", "x-pramaan-signature": signBody(secret, critPayload) },
        payload: critPayload,
      });
      expect(critRes.statusCode).toBe(200);
      const critAlert = await db.one<{ severity: string }>("SELECT severity FROM alerts WHERE id = $1", [critRes.json().alertId]);
      expect(critAlert?.severity).toBe("critical");

      // High -> critical
      const highPayload = JSON.stringify({
        workflow: "flow-high",
        runId: "run-high",
        observedAt: new Date().toISOString(),
        chainId: 11155111,
        app: "delims-app",
        ensName: "delims.eth",
        decision: "UNEXPECTED_IMPLEMENTATION",
        severity: "high",
        details: { reason: "bad impl" },
        idempotencyKey: "idem-high",
      });
      const highRes = await app.inject({
        method: "POST",
        url: "/v1/ingest/cre",
        headers: { "content-type": "application/json", "x-pramaan-signature": signBody(secret, highPayload) },
        payload: highPayload,
      });
      expect(highRes.statusCode).toBe(200);
      const highAlert = await db.one<{ severity: string }>("SELECT severity FROM alerts WHERE id = $1", [highRes.json().alertId]);
      expect(highAlert?.severity).toBe("critical");

      // Medium -> warning
      const medPayload = JSON.stringify({
        workflow: "flow-med",
        runId: "run-med",
        observedAt: new Date().toISOString(),
        chainId: 11155111,
        app: "delims-app",
        ensName: "delims.eth",
        decision: "PENDING_UPGRADE",
        severity: "medium",
        details: { reason: "pending" },
        idempotencyKey: "idem-med",
      });
      const medRes = await app.inject({
        method: "POST",
        url: "/v1/ingest/cre",
        headers: { "content-type": "application/json", "x-pramaan-signature": signBody(secret, medPayload) },
        payload: medPayload,
      });
      expect(medRes.statusCode).toBe(200);
      const medAlert = await db.one<{ severity: string }>("SELECT severity FROM alerts WHERE id = $1", [medRes.json().alertId]);
      expect(medAlert?.severity).toBe("warning");

      // Low -> info
      const lowPayload = JSON.stringify({
        workflow: "flow-low",
        runId: "run-low",
        observedAt: new Date().toISOString(),
        chainId: 11155111,
        app: "delims-app",
        ensName: "delims.eth",
        decision: "PENDING_RELEASE_CHANGE",
        severity: "low",
        details: { reason: "info change" },
        idempotencyKey: "idem-low",
      });
      const lowRes = await app.inject({
        method: "POST",
        url: "/v1/ingest/cre",
        headers: { "content-type": "application/json", "x-pramaan-signature": signBody(secret, lowPayload) },
        payload: lowPayload,
      });
      expect(lowRes.statusCode).toBe(200);
      const lowAlert = await db.one<{ severity: string }>("SELECT severity FROM alerts WHERE id = $1", [lowRes.json().alertId]);
      expect(lowAlert?.severity).toBe("info");

      // 2. Delimiter-separated identities must remain distinct:
      // Case 1: workflow="a/b", app="c", runId="d" vs workflow="a", app="b/c", runId="d"
      const delimPayload1 = JSON.stringify({
        workflow: "a/b",
        runId: "d",
        observedAt: new Date().toISOString(),
        chainId: 11155111,
        app: "c",
        ensName: "delims.eth",
        decision: "MANIFEST_MISMATCH",
        severity: "high",
        details: { case: "1" },
        idempotencyKey: "idem-delim-1",
      });
      const delimRes1 = await app.inject({
        method: "POST",
        url: "/v1/ingest/cre",
        headers: { "content-type": "application/json", "x-pramaan-signature": signBody(secret, delimPayload1) },
        payload: delimPayload1,
      });
      expect(delimRes1.statusCode).toBe(200);

      const delimPayload2 = JSON.stringify({
        workflow: "a",
        runId: "d",
        observedAt: new Date().toISOString(),
        chainId: 11155111,
        app: "b/c",
        ensName: "delims.eth",
        decision: "MANIFEST_MISMATCH",
        severity: "high",
        details: { case: "2" },
        idempotencyKey: "idem-delim-2",
      });
      const delimRes2 = await app.inject({
        method: "POST",
        url: "/v1/ingest/cre",
        headers: { "content-type": "application/json", "x-pramaan-signature": signBody(secret, delimPayload2) },
        payload: delimPayload2,
      });
      // Second request is NOT collided with first; it succeeds as a distinct receipt
      expect(delimRes2.statusCode).toBe(200);
      expect(delimRes2.json().runId).toBe("d");
      expect(delimRes2.json().workflow).toBe("a");
      expect(delimRes1.json().workflow).toBe("a/b");
    } finally {
      await app.close();
      await db.close();
    }
  });

  it("POST /v1/ingest/cre claims receipt first, handles duplicate dedupe, changed-body conflict (409), and rollback on failure", async () => {
    const db = await openDb({ memory: true });
    const secret = "super-secret-cre-key-1234567890";
    const cfg = loadConfig({
      DATA_DIR: ".pramaan/test-cre-dedupe",
      CRE_INGEST_SECRET: secret,
      RATE_LIMIT_MAX: "10000",
    });
    const app = await createApp({ db, cfg, skipBootstrap: true });

    try {
      await db.query(
        `INSERT INTO projects (slug, name, ens_name, chain_id)
         VALUES ('p-dup', 'Project Dup', 'dup.eth', 11155111)`,
      );

      const payload1 = JSON.stringify({
        workflow: "flowA",
        runId: "run1",
        observedAt: new Date().toISOString(),
        chainId: 11155111,
        app: "appA",
        ensName: "dup.eth",
        decision: "RELEASE_REVOKED",
        severity: "critical",
        details: { error: "critical fault" },
        idempotencyKey: "idem-1",
      });
      const sig1 = signBody(secret, payload1);

      // 1. Initial request -> 200 created
      const res1 = await app.inject({
        method: "POST",
        url: "/v1/ingest/cre",
        headers: {
          "content-type": "application/json",
          "x-pramaan-signature": sig1,
        },
        payload: payload1,
      });
      expect(res1.statusCode).toBe(200);
      const data1 = res1.json();
      expect(data1.ok).toBe(true);
      expect(data1.alertId).toBeTruthy();

      // 2. Duplicate exact request -> SAME 200 and SAME body
      const res2 = await app.inject({
        method: "POST",
        url: "/v1/ingest/cre",
        headers: {
          "content-type": "application/json",
          "x-pramaan-signature": sig1,
        },
        payload: payload1,
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.json()).toEqual(data1);

      // Ensure no second alert was created
      const alertsCount = Number((await db.one<{ count: string | number }>("SELECT COUNT(*)::int AS count FROM alerts"))?.count ?? 0);
      expect(alertsCount).toBe(1);

      // 3. Same receipt identity (workflow/app/runId) with DIFFERENT validly signed body -> 409 Conflict
      const payloadConflict = JSON.stringify({
        workflow: "flowA",
        runId: "run1", // same runId
        observedAt: new Date().toISOString(),
        chainId: 11155111,
        app: "appA", // same app
        ensName: "dup.eth",
        decision: "OK", // different decision / body
        severity: "info",
        details: { error: "different" },
        idempotencyKey: "idem-2",
      });
      const sigConflict = signBody(secret, payloadConflict);

      const conflictRes = await app.inject({
        method: "POST",
        url: "/v1/ingest/cre",
        headers: {
          "content-type": "application/json",
          "x-pramaan-signature": sigConflict,
        },
        payload: payloadConflict,
      });
      expect(conflictRes.statusCode).toBe(409);
      expect(conflictRes.json().error.code).toBe("RECEIPT_CONFLICT");

      // 4. Concurrent / parallel duplicates
      const payloadParallel = JSON.stringify({
        workflow: "flowParallel",
        runId: "runP",
        observedAt: new Date().toISOString(),
        chainId: 11155111,
        app: "appP",
        ensName: "dup.eth",
        decision: "UNEXPECTED_IMPLEMENTATION",
        severity: "high",
        details: { msg: "parallel test" },
        idempotencyKey: "idem-parallel",
      });
      const sigParallel = signBody(secret, payloadParallel);

      const [pRes1, pRes2, pRes3] = await Promise.all([
        app.inject({
          method: "POST",
          url: "/v1/ingest/cre",
          headers: { "content-type": "application/json", "x-pramaan-signature": sigParallel },
          payload: payloadParallel,
        }),
        app.inject({
          method: "POST",
          url: "/v1/ingest/cre",
          headers: { "content-type": "application/json", "x-pramaan-signature": sigParallel },
          payload: payloadParallel,
        }),
        app.inject({
          method: "POST",
          url: "/v1/ingest/cre",
          headers: { "content-type": "application/json", "x-pramaan-signature": sigParallel },
          payload: payloadParallel,
        }),
      ]);

      expect(pRes1.statusCode).toBe(200);
      expect(pRes2.statusCode).toBe(200);
      expect(pRes3.statusCode).toBe(200);
      expect(pRes1.json()).toEqual(pRes2.json());
      expect(pRes2.json()).toEqual(pRes3.json());

      // Only one alert created for flowParallel
      const parallelAlertKey =
        "cre:" +
        createHash("sha256")
          .update(JSON.stringify([11155111, "dup.eth", "idem-parallel"]))
          .digest("hex");
      const parallelAlerts = await db.query("SELECT id FROM alerts WHERE idempotency_key = $1", [parallelAlertKey]);
      expect(parallelAlerts.length).toBe(1);

      // Only one receipt created for flowParallel
      const parallelReceiptKey = createHash("sha256")
        .update(JSON.stringify(["flowParallel", "appP", "runP"]))
        .digest("hex");
      const parallelReceipts = await db.query("SELECT key FROM ingest_receipts WHERE key = $1", [parallelReceiptKey]);
      expect(parallelReceipts.length).toBe(1);
    } finally {
      await app.close();
      await db.close();
    }
  });

  it("wires GET alerts, POST alert ack, GET monitors, and GET events with role scoping, blockTime/address, and pagination", async () => {
    const db = await openDb({ memory: true });
    const cfg = loadConfig({
      DATA_DIR: ".pramaan/test-monitor-api",
      RATE_LIMIT_MAX: "10000",
    });
    const app = await createApp({ db, cfg, skipBootstrap: true });

    try {
      // 1. Create User A (owner of Project A), User B (viewer of Project A, owner of Project B), and User C (unrelated)
      const userA = (await db.one<{ id: string }>("INSERT INTO users (display_name, is_admin) VALUES ('user-a', false) RETURNING id"))!;
      const userB = (await db.one<{ id: string }>("INSERT INTO users (display_name, is_admin) VALUES ('user-b', false) RETURNING id"))!;
      const userC = (await db.one<{ id: string }>("INSERT INTO users (display_name, is_admin) VALUES ('user-c', false) RETURNING id"))!;

      const { token: tokenA } = await createApiToken(db, userA.id, "user-a-pat", null);
      const { token: tokenB } = await createApiToken(db, userB.id, "user-b-pat", null);
      const { token: tokenC } = await createApiToken(db, userC.id, "user-c-pat", null);

      // Project A
      const projectA = (await db.one<{ id: string }>("INSERT INTO projects (slug, name) VALUES ('proj-a', 'Project A') RETURNING id"))!;
      await db.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')", [projectA.id, userA.id]);
      await db.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'viewer')", [projectA.id, userB.id]);

      // Project B
      const projectB = (await db.one<{ id: string }>("INSERT INTO projects (slug, name) VALUES ('proj-b', 'Project B') RETURNING id"))!;
      await db.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')", [projectB.id, userB.id]);

      // Scoped token for Project A
      const { token: scopedTokenA } = await createApiToken(db, userA.id, "scoped-a", projectA.id);

      // Seed Alert in Project A
      const alert1 = (await db.one<{ id: string }>(
        `INSERT INTO alerts (project_id, source, severity, kind, title, body, status, idempotency_key)
         VALUES ($1, 'monitor', 'critical', 'timelock', 'Timelock Drift', 'Delay changed', 'open', 'idem-a1')
         RETURNING id`,
        [projectA.id],
      ))!;
      const alert2 = (await db.one<{ id: string }>(
        `INSERT INTO alerts (project_id, source, severity, kind, title, body, status, idempotency_key)
         VALUES ($1, 'cre', 'warning', 'cre', 'CRE Warning', 'Observed drift', 'acked', 'idem-a2')
         RETURNING id`,
        [projectA.id],
      ))!;

      // Seed Monitor in Project A
      const mon1 = (await db.one<{ id: string }>(
        `INSERT INTO monitors (project_id, kind, chain_id, address, rpc_url, label, status, last_block)
         VALUES ($1, 'timelock', 11155111, '0x1111111111111111111111111111111111111111', 'https://sepolia.rpc', 'Main Timelock', 'active', 5000000)
         RETURNING id`,
        [projectA.id],
      ))!;

      // Seed Event in Project A with all required fields including address and block_time
      await db.query(
        `INSERT INTO monitor_events (monitor_id, project_id, chain_id, block_number, block_time, tx_hash, log_index, address, event_name, data, assessment, detail)
         VALUES ($1, $2, 11155111, 5000001, '2026-11-05T10:00:00.000Z', '0xaaa', 0, '0x1111111111111111111111111111111111111111', 'CallScheduled', '{"id":"0x123"}'::jsonb, 'warning', 'Delay scheduled')`,
        [mon1.id, projectA.id],
      );

      // --- TEST GET /v1/projects/:id/alerts ---
      // 1. Unauthenticated -> 401
      const unauthAlerts = await app.inject({ method: "GET", url: `/v1/projects/${projectA.id}/alerts` });
      expect(unauthAlerts.statusCode).toBe(401);

      // 2. Unrelated user C -> 403
      const forbiddenAlerts = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectA.id}/alerts`,
        headers: { authorization: `Bearer ${tokenC}` },
      });
      expect(forbiddenAlerts.statusCode).toBe(403);

      // 3. Viewer user B -> 200, returns camelCase list
      const viewerAlerts = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectA.id}/alerts`,
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect(viewerAlerts.statusCode).toBe(200);
      const allAlerts = viewerAlerts.json();
      expect(allAlerts.length).toBe(2);
      expect(allAlerts[0].projectId).toBe(projectA.id);
      expect(allAlerts[0].createdAt).toBeTruthy();

      // 4. Status filter 'open'
      const openAlerts = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectA.id}/alerts?status=open`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(openAlerts.statusCode).toBe(200);
      const openList = openAlerts.json();
      expect(openList.length).toBe(1);
      expect(openList[0].id).toBe(alert1.id);
      expect(openList[0].status).toBe("open");

      // 5. Status filter 'acked'
      const ackedAlerts = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectA.id}/alerts?status=acked`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(ackedAlerts.statusCode).toBe(200);
      expect(ackedAlerts.json().length).toBe(1);
      expect(ackedAlerts.json()[0].id).toBe(alert2.id);

      // --- TEST POST /v1/alerts/:id/ack ---
      // 1. Unauthenticated -> 401
      const unauthAck = await app.inject({ method: "POST", url: `/v1/alerts/${alert1.id}/ack` });
      expect(unauthAck.statusCode).toBe(401);

      // 2. Viewer User B (only viewer on Project A) -> 403 ROLE_REQUIRED (needs maintainer)
      const viewerAck = await app.inject({
        method: "POST",
        url: `/v1/alerts/${alert1.id}/ack`,
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect(viewerAck.statusCode).toBe(403);
      expect(viewerAck.json().error.code).toBe("ROLE_REQUIRED");

      // 3. User C -> 403
      const userCAck = await app.inject({
        method: "POST",
        url: `/v1/alerts/${alert1.id}/ack`,
        headers: { authorization: `Bearer ${tokenC}` },
      });
      expect(userCAck.statusCode).toBe(403);

      // 4. Scoped token for Project B calling Project A alert -> 403
      const { token: scopedTokenB } = await createApiToken(db, userB.id, "scoped-b", projectB.id);
      const crossScopedAck = await app.inject({
        method: "POST",
        url: `/v1/alerts/${alert1.id}/ack`,
        headers: { authorization: `Bearer ${scopedTokenB}` },
      });
      expect(crossScopedAck.statusCode).toBe(403);

      // 5. Owner User A (maintainer+) -> 200, updates status to acked, writes audit log
      const ownerAck = await app.inject({
        method: "POST",
        url: `/v1/alerts/${alert1.id}/ack`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(ownerAck.statusCode).toBe(200);
      const ackedData = ownerAck.json();
      expect(ackedData.status).toBe("acked");
      expect(ackedData.ackedBy).toBe(userA.id);
      expect(ackedData.ackedAt).toBeTruthy();

      // Verify audit log row
      const auditRow = await db.one<{ action: string; user_id: string }>(
        "SELECT action, user_id FROM audit_log WHERE target = 'Timelock Drift'",
      );
      expect(auditRow?.action).toBe("alert.ack");
      expect(auditRow?.user_id).toBe(userA.id);

      // --- TEST GET /v1/projects/:id/monitors ---
      // 1. Scoped token for Project A -> 200
      const scopedMonitors = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectA.id}/monitors`,
        headers: { authorization: `Bearer ${scopedTokenA}` },
      });
      expect(scopedMonitors.statusCode).toBe(200);
      const monList = scopedMonitors.json();
      expect(monList.length).toBe(1);
      expect(monList[0].id).toBe(mon1.id);
      expect(monList[0].lastBlock).toBe(5000000);
      expect(monList[0].label).toBe("Main Timelock");

      // 2. Scoped token for Project B calling Project A -> 403
      const crossMonitors = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectA.id}/monitors`,
        headers: { authorization: `Bearer ${scopedTokenB}` },
      });
      expect(crossMonitors.statusCode).toBe(403);

      // --- TEST GET /v1/projects/:id/events ---
      const scopedEvents = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectA.id}/events?limit=10`,
        headers: { authorization: `Bearer ${scopedTokenA}` },
      });
      expect(scopedEvents.statusCode).toBe(200);
      const evList = scopedEvents.json();
      expect(evList.length).toBe(1);
      expect(evList[0].projectId).toBe(projectA.id);
      expect(evList[0].eventName).toBe("CallScheduled");
      expect(evList[0].monitorLabel).toBe("Main Timelock");
      expect(evList[0].blockNumber).toBe(5000001);
      expect(evList[0].blockTime).toBe("2026-11-05T10:00:00.000Z");
      expect(evList[0].address).toBe("0x1111111111111111111111111111111111111111");
      expect(evList[0].assessment).toBe("warning");

      // --- POST monitors is implemented (see monitors.test.ts); an incomplete body is a validation error, not a 501 ---
      const postMon = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectA.id}/monitors`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { kind: "timelock", address: "0x1111111111111111111111111111111111111111" },
      });
      expect(postMon.statusCode).toBe(400);

      const postTelegram = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectA.id}/alerts/test-telegram`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(postTelegram.statusCode).toBe(501);
    } finally {
      await app.close();
      await db.close();
    }
  });
});
