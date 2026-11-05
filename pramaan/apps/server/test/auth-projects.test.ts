import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { createApp } from "../src/app.js";
import { createApiToken } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";

describe("auth, tokens, projects and stats API slice", () => {
  it("authenticates via SIWE, rejects nonce replay, and rejects cookie mutations without CSRF", async () => {
    const db = await openDb({ memory: true });
    const cfg = loadConfig({
      DATA_DIR: ".pramaan/test-auth",
      RATE_LIMIT_PUBLIC_MAX: "10000",
      RATE_LIMIT_AUTH_MAX: "10000",
      RATE_LIMIT_WINDOW_MS: "60000",
    });

    const app = await createApp({ db, cfg, skipBootstrap: true });
    try {
      // 1. Issue nonce
      const nonceRes = await app.inject({ method: "GET", url: "/v1/auth/nonce" });
      expect(nonceRes.statusCode).toBe(200);
      const { nonce } = nonceRes.json<{ nonce: string }>();
      expect(nonce).toMatch(/^[0-9a-f]{32}$/);

      // 2. Sign SIWE message
      const privateKey = generatePrivateKey();
      const account = privateKeyToAccount(privateKey);
      const issuedAt = new Date();
      const message = createSiweMessage({
        address: account.address,
        chainId: 1,
        domain: "127.0.0.1:5173",
        uri: "http://127.0.0.1:5173",
        nonce,
        version: "1",
        statement: "Sign in to Pramaan",
        issuedAt,
        expirationTime: new Date(issuedAt.getTime() + 10 * 60_000),
      });
      const signature = await account.signMessage({ message });

      // 3. Login with SIWE
      const siweRes = await app.inject({
        method: "POST",
        url: "/v1/auth/siwe",
        payload: { message, signature },
      });
      expect(siweRes.statusCode).toBe(200);
      const siweData = siweRes.json<{ user: { id: string; address: string; isAdmin: boolean }; csrfToken: string }>();
      expect(siweData.user.address.toLowerCase()).toBe(account.address.toLowerCase());
      expect(siweData.csrfToken).toBeTruthy();

      const sessionCookie = siweRes.cookies.find((c) => c.name === "pramaan_session");
      expect(sessionCookie).toBeTruthy();
      const cookieHeader = `pramaan_session=${sessionCookie!.value}`;

      // 4. Nonce replay rejection
      const replayRes = await app.inject({
        method: "POST",
        url: "/v1/auth/siwe",
        payload: { message, signature },
      });
      expect(replayRes.statusCode).toBe(401);
      expect(replayRes.json<{ error: { code: string } }>().error.code).toBe("SIWE_NONCE");

      // 5. GET /v1/me with cookie
      const meRes = await app.inject({
        method: "GET",
        url: "/v1/me",
        headers: { cookie: cookieHeader },
      });
      expect(meRes.statusCode).toBe(200);
      expect(meRes.json<{ user: { id: string } }>().user.id).toBe(siweData.user.id);

      // 6. Cookie mutation rejected without CSRF
      const noCsrfRes = await app.inject({
        method: "POST",
        url: "/v1/projects",
        headers: { cookie: cookieHeader },
        payload: { name: "Project Alpha" },
      });
      expect(noCsrfRes.statusCode).toBe(403);
      expect(noCsrfRes.json<{ error: { code: string } }>().error.code).toBe("CSRF_INVALID");

      // 7. Cookie mutation rejected with invalid CSRF
      const badCsrfRes = await app.inject({
        method: "POST",
        url: "/v1/projects",
        headers: { cookie: cookieHeader, "x-pramaan-csrf": "invalid-token" },
        payload: { name: "Project Alpha" },
      });
      expect(badCsrfRes.statusCode).toBe(403);

      // 8. Cookie mutation accepted with valid CSRF
      const createRes = await app.inject({
        method: "POST",
        url: "/v1/projects",
        headers: { cookie: cookieHeader, "x-pramaan-csrf": siweData.csrfToken },
        payload: { name: "Project Alpha", domain: "alpha.example.com" },
      });
      expect(createRes.statusCode).toBe(201);
      const createdProject = createRes.json<{ id: string; name: string; domain: string }>();
      expect(createdProject.name).toBe("Project Alpha");
      expect(createdProject.domain).toBe("alpha.example.com");

      // 9. Logout
      const logoutRes = await app.inject({
        method: "POST",
        url: "/v1/auth/logout",
        headers: { cookie: cookieHeader, "x-pramaan-csrf": siweData.csrfToken },
      });
      expect(logoutRes.statusCode).toBe(200);

      // 10. me is now 401
      const loggedOutMe = await app.inject({
        method: "GET",
        url: "/v1/me",
        headers: { cookie: cookieHeader },
      });
      expect(loggedOutMe.statusCode).toBe(401);
    } finally {
      await app.close();
      await db.close();
    }
  });

  it("handles project-scoped bearer tokens, project CRUD, cross-project protection, and token revocation", async () => {
    const db = await openDb({ memory: true });
    const cfg = loadConfig({
      DATA_DIR: ".pramaan/test-projects",
      RATE_LIMIT_PUBLIC_MAX: "10000",
      RATE_LIMIT_AUTH_MAX: "10000",
    });

    const app = await createApp({ db, cfg, skipBootstrap: true });
    try {
      // 1. Sign in as ordinary member
      const nonce = (await (await app.inject({ method: "GET", url: "/v1/auth/nonce" })).json()).nonce;
      const account = privateKeyToAccount(generatePrivateKey());
      const message = createSiweMessage({
        address: account.address,
        chainId: 1,
        domain: "127.0.0.1:5173",
        uri: "http://127.0.0.1:5173",
        nonce,
        version: "1",
        statement: "Sign in",
        issuedAt: new Date(),
      });
      const signature = await account.signMessage({ message });
      const siwe = await app.inject({
        method: "POST",
        url: "/v1/auth/siwe",
        payload: { message, signature },
      });
      const cookieHeader = `pramaan_session=${siwe.cookies[0]!.value}`;
      const csrf = siwe.json().csrfToken;
      const userId = siwe.json().user.id;

      // 2. Create Project 1 (Alpha) and Project 2 (Beta) owned by ordinary member
      const p1Res = await app.inject({
        method: "POST",
        url: "/v1/projects",
        headers: { cookie: cookieHeader, "x-pramaan-csrf": csrf },
        payload: { name: "Project Alpha", domain: "alpha.test" },
      });
      expect(p1Res.statusCode).toBe(201);
      const p1 = p1Res.json<{ id: string; name: string }>();

      const p2Res = await app.inject({
        method: "POST",
        url: "/v1/projects",
        headers: { cookie: cookieHeader, "x-pramaan-csrf": csrf },
        payload: { name: "Project Beta", domain: "beta.test" },
      });
      expect(p2Res.statusCode).toBe(201);
      const p2 = p2Res.json<{ id: string; name: string }>();

      // 3. Create a Demo project (is_demo = true)
      const demoRes = await app.inject({
        method: "POST",
        url: "/v1/projects",
        headers: { cookie: cookieHeader, "x-pramaan-csrf": csrf },
        payload: { name: "Demo Delta" },
      });
      expect(demoRes.statusCode).toBe(201);
      const demo = demoRes.json<{ id: string; name: string }>();
      await db.query("UPDATE projects SET is_demo = true WHERE id = $1", [demo.id]);

      // Cookie session sees all 3 projects (Alpha, Beta, Demo)
      const fullListRes = await app.inject({
        method: "GET",
        url: "/v1/projects",
        headers: { cookie: cookieHeader },
      });
      expect(fullListRes.statusCode).toBe(200);
      expect(fullListRes.json<Array<{ id: string }>>().length).toBe(3);

      // 4. Create a project-scoped API token for Project Alpha
      const tokenRes = await app.inject({
        method: "POST",
        url: "/v1/tokens",
        headers: { cookie: cookieHeader, "x-pramaan-csrf": csrf },
        payload: { name: "alpha-ci-token", projectId: p1.id },
      });
      expect(tokenRes.statusCode).toBe(201);
      const { id: tokenId, token: alphaToken } = tokenRes.json<{ id: string; token: string }>();
      expect(alphaToken).toMatch(/^pat_/);

      // 5. Scoped token owned by ordinary member owning two projects + demo project:
      // lists ONLY permitted scoped project (Alpha)!
      const scopedListRes = await app.inject({
        method: "GET",
        url: "/v1/projects",
        headers: { authorization: `Bearer ${alphaToken}` },
      });
      expect(scopedListRes.statusCode).toBe(200);
      const scopedList = scopedListRes.json<Array<{ id: string; name: string }>>();
      expect(scopedList.length).toBe(1);
      expect(scopedList[0]?.id).toBe(p1.id);
      expect(scopedList[0]?.name).toBe("Project Alpha");

      // 6. Admin user with scoped token: lists ONLY permitted scoped project
      const adminUser = await db.one<{ id: string }>(
        "INSERT INTO users (display_name, is_admin) VALUES ('superadmin', true) RETURNING id",
      );
      const { token: adminBetaToken } = await createApiToken(db, adminUser!.id, "admin-beta-token", p2.id);

      const adminScopedListRes = await app.inject({
        method: "GET",
        url: "/v1/projects",
        headers: { authorization: `Bearer ${adminBetaToken}` },
      });
      expect(adminScopedListRes.statusCode).toBe(200);
      const adminScopedList = adminScopedListRes.json<Array<{ id: string; name: string }>>();
      expect(adminScopedList.length).toBe(1);
      expect(adminScopedList[0]?.id).toBe(p2.id);
      expect(adminScopedList[0]?.name).toBe("Project Beta");

      // 7. Bearer exemption with project scope: mutating Project Alpha needs NO CSRF header
      const patchAlpha = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${p1.id}`,
        headers: { authorization: `Bearer ${alphaToken}` },
        payload: { domain: "updated-alpha.test" },
      });
      expect(patchAlpha.statusCode).toBe(200);
      expect(patchAlpha.json<{ domain: string }>().domain).toBe("updated-alpha.test");

      // 8. Unauthorized cross-project access: token for Alpha cannot access Beta or Demo
      const crossPatchBeta = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${p2.id}`,
        headers: { authorization: `Bearer ${alphaToken}` },
        payload: { domain: "hacked-beta.test" },
      });
      expect(crossPatchBeta.statusCode).toBe(403);

      const crossReadBeta = await app.inject({
        method: "GET",
        url: `/v1/projects/${p2.id}`,
        headers: { authorization: `Bearer ${alphaToken}` },
      });
      expect(crossReadBeta.statusCode).toBe(403);

      const crossReadDemo = await app.inject({
        method: "GET",
        url: `/v1/projects/${demo.id}`,
        headers: { authorization: `Bearer ${alphaToken}` },
      });
      expect(crossReadDemo.statusCode).toBe(403);

      const crossPatchDemo = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${demo.id}`,
        headers: { authorization: `Bearer ${alphaToken}` },
        payload: { domain: "hacked-demo.test" },
      });
      expect(crossPatchDemo.statusCode).toBe(403);

      // 9. Admin scoped token cannot cross-access Project Alpha
      const adminCrossRead = await app.inject({
        method: "GET",
        url: `/v1/projects/${p1.id}`,
        headers: { authorization: `Bearer ${adminBetaToken}` },
      });
      expect(adminCrossRead.statusCode).toBe(403);

      // 10. Project-scoped token cannot do account-level operations
      const illegalCreate = await app.inject({
        method: "POST",
        url: "/v1/projects",
        headers: { authorization: `Bearer ${alphaToken}` },
        payload: { name: "Gamma" },
      });
      expect(illegalCreate.statusCode).toBe(403);
      expect(illegalCreate.json<{ error: { code: string } }>().error.code).toBe("TOKEN_SCOPE");

      const illegalTokenCreate = await app.inject({
        method: "POST",
        url: "/v1/tokens",
        headers: { authorization: `Bearer ${alphaToken}` },
        payload: { name: "sub-token" },
      });
      expect(illegalTokenCreate.statusCode).toBe(403);
      expect(illegalTokenCreate.json<{ error: { code: string } }>().error.code).toBe("TOKEN_SCOPE");

      // 11. Read project detail via cookie
      const detailRes = await app.inject({
        method: "GET",
        url: `/v1/projects/${p1.id}`,
        headers: { cookie: cookieHeader },
      });
      expect(detailRes.statusCode).toBe(200);
      const detail = detailRes.json<{ members: Array<{ role: string }>; domain: string }>();
      expect(detail.domain).toBe("updated-alpha.test");
      expect(detail.members[0]?.role).toBe("owner");

      // 12. Revoke token
      const deleteToken = await app.inject({
        method: "DELETE",
        url: `/v1/tokens/${tokenId}`,
        headers: { cookie: cookieHeader, "x-pramaan-csrf": csrf },
      });
      expect(deleteToken.statusCode).toBe(200);

      // Using revoked token is unauthorized
      const useRevoked = await app.inject({
        method: "GET",
        url: "/v1/me",
        headers: { authorization: `Bearer ${alphaToken}` },
      });
      expect(useRevoked.statusCode).toBe(401);

      // Revoking already revoked token returns 404
      const deleteAgain = await app.inject({
        method: "DELETE",
        url: `/v1/tokens/${tokenId}`,
        headers: { cookie: cookieHeader, "x-pramaan-csrf": csrf },
      });
      expect(deleteAgain.statusCode).toBe(404);
    } finally {
      await app.close();
      await db.close();
    }
  });

  it("protects /v1/stats from unauthenticated and scoped callers, returning real empty and populated stats", async () => {
    const db = await openDb({ memory: true });
    const cfg = loadConfig({
      DATA_DIR: ".pramaan/test-stats",
      RATE_LIMIT_PUBLIC_MAX: "10000",
      RATE_LIMIT_AUTH_MAX: "10000",
    });

    const app = await createApp({ db, cfg, skipBootstrap: true });
    try {
      // 1. Unauthenticated /v1/stats is rejected with 401
      const unauthRes = await app.inject({ method: "GET", url: "/v1/stats" });
      expect(unauthRes.statusCode).toBe(401);

      // 2. Setup user session
      const nonce = (await (await app.inject({ method: "GET", url: "/v1/auth/nonce" })).json()).nonce;
      const account = privateKeyToAccount(generatePrivateKey());
      const message = createSiweMessage({
        address: account.address,
        chainId: 1,
        domain: "127.0.0.1:5173",
        uri: "http://127.0.0.1:5173",
        nonce,
        version: "1",
        statement: "Sign in",
        issuedAt: new Date(),
      });
      const signature = await account.signMessage({ message });
      const siwe = await app.inject({
        method: "POST",
        url: "/v1/auth/siwe",
        payload: { message, signature },
      });
      const cookieHeader = `pramaan_session=${siwe.cookies[0]!.value}`;
      const csrf = siwe.json().csrfToken;
      const userId = siwe.json().user.id;

      // 3. Project-scoped token is rejected with 403 TOKEN_SCOPE
      const project = await db.one<{ id: string }>(
        "INSERT INTO projects (slug, name) VALUES ('my-project', 'My Project') RETURNING id",
      );
      await db.query(
        "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')",
        [project!.id, userId],
      );

      const { token: scopedToken } = await createApiToken(db, userId, "scoped-stat-tok", project!.id);
      const scopedRes = await app.inject({
        method: "GET",
        url: "/v1/stats",
        headers: { authorization: `Bearer ${scopedToken}` },
      });
      expect(scopedRes.statusCode).toBe(403);
      expect(scopedRes.json().error.code).toBe("TOKEN_SCOPE");

      // 4. Authenticated account-level caller gets empty stats
      const emptyRes = await app.inject({
        method: "GET",
        url: "/v1/stats",
        headers: { cookie: cookieHeader },
      });
      expect(emptyRes.statusCode).toBe(200);
      expect(emptyRes.json()).toEqual({
        projects: 1, // 'my-project'
        jobs: {
          QUEUED: 0,
          RUNNING: 0,
          COMPLETED: 0,
          FAILED: 0,
          CANCELLED: 0,
        },
        findings: {
          reproduced: 0,
          fixedVerified: 0,
          notReproduced: 0,
          candidate: 0,
          falsePositive: 0,
        },
        releases: {
          active: 0,
          queued: 0,
        },
        alerts: {
          open: 0,
          critical: 0,
        },
      });

      // 5. Populate real rows
      // Jobs
      await db.query(
        `INSERT INTO analysis_jobs (project_id, kind, status, source, toolchain_hash, request_hash, idempotency_key)
         VALUES
          ($1, 'analyze', 'QUEUED', '{}'::jsonb, 'th1', 'rh1', 'idem1'),
          ($1, 'analyze', 'RUNNING', '{}'::jsonb, 'th2', 'rh2', 'idem2'),
          ($1, 'analyze', 'COMPLETED', '{}'::jsonb, 'th3', 'rh3', 'idem3')`,
        [project!.id],
      );

      const jobCompleted = await db.one<{ id: string }>(
        "SELECT id FROM analysis_jobs WHERE status = 'COMPLETED'",
      );

      // Findings
      await db.query(
        `INSERT INTO findings (project_id, job_id, label, finding_key, vuln_class, title, severity, confidence, status, contract, sources, engine_result, review_decision)
         VALUES
          ($1, $2, 'F1', 'k1', 'reentrancy', 'Reentrancy', 'high', 'high', 'reproduced', 'Vault', '[]'::jsonb, '{}'::jsonb, null),
          ($1, $2, 'F2', 'k2', 'overflow', 'Overflow', 'medium', 'high', 'fixed-verified', 'Token', '[]'::jsonb, '{}'::jsonb, null),
          ($1, $2, 'F3', 'k3', 'bad-random', 'Bad Random', 'low', 'low', 'candidate', 'RNG', '[]'::jsonb, '{}'::jsonb, 'false-positive')`,
        [project!.id, jobCompleted!.id],
      );

      // Releases
      await db.query(
        `INSERT INTO releases (project_id, tag, manifest, manifest_bytes, manifest_sha256, pointer, signature_status, status)
         VALUES
          ($1, 'v1.0.0', '{}'::jsonb, '\\x01'::bytea, 'sha_act', 'ptr1', 'verified', 'active'),
          ($1, 'v1.1.0', '{}'::jsonb, '\\x02'::bytea, 'sha_q', 'ptr2', 'verified', 'queued')`,
        [project!.id],
      );

      // Alerts
      await db.query(
        `INSERT INTO alerts (project_id, source, severity, kind, title, body, idempotency_key, status)
         VALUES
          ($1, 'monitor', 'critical', 'timelock', 'Alert 1', 'Detail 1', 'idem_a1', 'open'),
          ($1, 'cre', 'warning', 'oracle', 'Alert 2', 'Detail 2', 'idem_a2', 'open'),
          ($1, 'monitor', 'critical', 'proxy', 'Alert 3', 'Detail 3', 'idem_a3', 'acked')`,
        [project!.id],
      );

      // 6. Query stats again with unscoped bearer token
      const { token: unscopedToken } = await createApiToken(db, userId, "unscoped-stat-tok", null);
      const populatedRes = await app.inject({
        method: "GET",
        url: "/v1/stats",
        headers: { authorization: `Bearer ${unscopedToken}` },
      });
      expect(populatedRes.statusCode).toBe(200);
      expect(populatedRes.json()).toEqual({
        projects: 1,
        jobs: {
          QUEUED: 1,
          RUNNING: 1,
          COMPLETED: 1,
          FAILED: 0,
          CANCELLED: 0,
        },
        findings: {
          reproduced: 1,
          fixedVerified: 1,
          notReproduced: 0,
          candidate: 0,
          falsePositive: 1,
        },
        releases: {
          active: 1,
          queued: 1,
        },
        alerts: {
          open: 2,
          critical: 1,
        },
      });
    } finally {
      await app.close();
      await db.close();
    }
  });

  it("closes only owned database resources on shutdown", async () => {
    // Injected db: app.close() does NOT close the db
    const injectedDb = await openDb({ memory: true });
    const injectedApp = await createApp({
      db: injectedDb,
      skipBootstrap: true,
      logger: false,
    });
    await injectedApp.close();

    // Verify injected db is still open and operational
    const check = await injectedDb.one<{ ok: number }>("SELECT 1 AS ok");
    expect(check?.ok).toBe(1);
    await injectedDb.close();

    // Owned db: app.close() closes the db
    const ownedApp = await createApp({
      cfg: loadConfig({
        DATA_DIR: ".pramaan/test-owned-shutdown",
        DATABASE_URL: undefined,
      }),
      skipBootstrap: true,
      logger: false,
    });
    // Closing owned app closes owned db without error
    await expect(ownedApp.close()).resolves.toBeUndefined();
  });

  it("scopes /v1/stats SQL counts to caller-permitted projects without count leakage between unrelated users", async () => {
    const db = await openDb({ memory: true });
    const cfg = loadConfig({
      DATA_DIR: ".pramaan/test-stats-leakage",
      RATE_LIMIT_PUBLIC_MAX: "10000",
      RATE_LIMIT_AUTH_MAX: "10000",
    });

    const app = await createApp({ db, cfg, skipBootstrap: true });
    try {
      // 1. Create User A (ordinary user 1), User B (ordinary user 2), and Admin
      const userA = await db.one<{ id: string }>(
        "INSERT INTO users (display_name, is_admin) VALUES ('user-a', false) RETURNING id",
      );
      const userB = await db.one<{ id: string }>(
        "INSERT INTO users (display_name, is_admin) VALUES ('user-b', false) RETURNING id",
      );
      const admin = await db.one<{ id: string }>(
        "INSERT INTO users (display_name, is_admin) VALUES ('admin', true) RETURNING id",
      );

      const { token: tokenA } = await createApiToken(db, userA!.id, "user-a-pat", null);
      const { token: tokenB } = await createApiToken(db, userB!.id, "user-b-pat", null);
      const { token: tokenAdmin } = await createApiToken(db, admin!.id, "admin-pat", null);

      // 2. Project A (owned by User A)
      const projectA = await db.one<{ id: string }>(
        "INSERT INTO projects (slug, name, is_demo) VALUES ('project-a', 'Project A', false) RETURNING id",
      );
      await db.query(
        "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')",
        [projectA!.id, userA!.id],
      );

      // Nonzero rows for Project A: COMPLETED job, reproduced finding, active release, critical alert
      await db.query(
        `INSERT INTO analysis_jobs (project_id, kind, status, source, toolchain_hash, request_hash, idempotency_key)
         VALUES ($1, 'analyze', 'COMPLETED', '{}'::jsonb, 'thA1', 'rhA1', 'idemA1')`,
        [projectA!.id],
      );
      const jobA = await db.one<{ id: string }>("SELECT id FROM analysis_jobs WHERE project_id = $1", [projectA!.id]);
      await db.query(
        `INSERT INTO findings (project_id, job_id, label, finding_key, vuln_class, title, severity, confidence, status, contract, sources, engine_result)
         VALUES ($1, $2, 'FA1', 'kA1', 'reentrancy', 'Reentrancy A', 'high', 'high', 'reproduced', 'VaultA', '[]'::jsonb, '{}'::jsonb)`,
        [projectA!.id, jobA!.id],
      );
      await db.query(
        `INSERT INTO releases (project_id, tag, manifest, manifest_bytes, manifest_sha256, pointer, signature_status, status)
         VALUES ($1, 'v1.0.0', '{}'::jsonb, '\\x01'::bytea, 'sha_rel_a', 'ptrA', 'verified', 'active')`,
        [projectA!.id],
      );
      await db.query(
        `INSERT INTO alerts (project_id, source, severity, kind, title, body, idempotency_key, status)
         VALUES ($1, 'monitor', 'critical', 'timelock', 'Alert A1', 'Detail A', 'idem_alert_a1', 'open')`,
        [projectA!.id],
      );

      // 3. Project B (owned by User B)
      const projectB = await db.one<{ id: string }>(
        "INSERT INTO projects (slug, name, is_demo) VALUES ('project-b', 'Project B', false) RETURNING id",
      );
      await db.query(
        "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')",
        [projectB!.id, userB!.id],
      );

      // Nonzero rows for Project B: RUNNING job, fixed-verified + false-positive findings, queued release, open warning alert
      await db.query(
        `INSERT INTO analysis_jobs (project_id, kind, status, source, toolchain_hash, request_hash, idempotency_key)
         VALUES ($1, 'analyze', 'RUNNING', '{}'::jsonb, 'thB1', 'rhB1', 'idemB1')`,
        [projectB!.id],
      );
      const jobB = await db.one<{ id: string }>("SELECT id FROM analysis_jobs WHERE project_id = $1", [projectB!.id]);
      await db.query(
        `INSERT INTO findings (project_id, job_id, label, finding_key, vuln_class, title, severity, confidence, status, contract, sources, engine_result, review_decision)
         VALUES
          ($1, $2, 'FB1', 'kB1', 'overflow', 'Overflow B', 'medium', 'high', 'fixed-verified', 'TokenB', '[]'::jsonb, '{}'::jsonb, null),
          ($1, $2, 'FB2', 'kB2', 'logic', 'Logic B', 'low', 'low', 'candidate', 'LogicB', '[]'::jsonb, '{}'::jsonb, 'false-positive')`,
        [projectB!.id, jobB!.id],
      );
      await db.query(
        `INSERT INTO releases (project_id, tag, manifest, manifest_bytes, manifest_sha256, pointer, signature_status, status)
         VALUES ($1, 'v2.0.0', '{}'::jsonb, '\\x02'::bytea, 'sha_rel_b', 'ptrB', 'verified', 'queued')`,
        [projectB!.id],
      );
      await db.query(
        `INSERT INTO alerts (project_id, source, severity, kind, title, body, idempotency_key, status)
         VALUES ($1, 'cre', 'warning', 'oracle', 'Alert B1', 'Detail B', 'idem_alert_b1', 'open')`,
        [projectB!.id],
      );

      // 4. Demo Project (is_demo = true, readable by all authenticated callers)
      const projectDemo = await db.one<{ id: string }>(
        "INSERT INTO projects (slug, name, is_demo) VALUES ('project-demo', 'Demo Project', true) RETURNING id",
      );
      await db.query(
        `INSERT INTO analysis_jobs (project_id, kind, status, source, toolchain_hash, request_hash, idempotency_key)
         VALUES ($1, 'analyze', 'QUEUED', '{}'::jsonb, 'thDemo', 'rhDemo', 'idemDemo')`,
        [projectDemo!.id],
      );
      const jobDemo = await db.one<{ id: string }>("SELECT id FROM analysis_jobs WHERE project_id = $1", [projectDemo!.id]);
      await db.query(
        `INSERT INTO findings (project_id, job_id, label, finding_key, vuln_class, title, severity, confidence, status, contract, sources, engine_result)
         VALUES ($1, $2, 'FDemo1', 'kDemo1', 'oracle', 'Oracle Demo', 'low', 'medium', 'candidate', 'Feed', '[]'::jsonb, '{}'::jsonb)`,
        [projectDemo!.id, jobDemo!.id],
      );

      // 5. Query stats as User A: sees Project A + Demo ONLY (no count leakage from Project B)
      const statsResA = await app.inject({
        method: "GET",
        url: "/v1/stats",
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(statsResA.statusCode).toBe(200);
      expect(statsResA.json()).toEqual({
        projects: 2, // Project A + Demo
        jobs: {
          QUEUED: 1, // Demo
          RUNNING: 0, // B's RUNNING job NOT leaked
          COMPLETED: 1, // A
          FAILED: 0,
          CANCELLED: 0,
        },
        findings: {
          reproduced: 1, // A
          fixedVerified: 0, // B's fixedVerified NOT leaked
          notReproduced: 0,
          candidate: 1, // Demo
          falsePositive: 0, // B's falsePositive NOT leaked
        },
        releases: {
          active: 1, // A
          queued: 0, // B's queued release NOT leaked
        },
        alerts: {
          open: 1, // A's open alert (B's warning alert NOT leaked)
          critical: 1, // A's critical alert
        },
      });

      // 6. Query stats as User B: sees Project B + Demo ONLY (no count leakage from Project A)
      const statsResB = await app.inject({
        method: "GET",
        url: "/v1/stats",
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect(statsResB.statusCode).toBe(200);
      expect(statsResB.json()).toEqual({
        projects: 2, // Project B + Demo
        jobs: {
          QUEUED: 1, // Demo
          RUNNING: 1, // B
          COMPLETED: 0, // A's COMPLETED job NOT leaked
          FAILED: 0,
          CANCELLED: 0,
        },
        findings: {
          reproduced: 0, // A's reproduced NOT leaked
          fixedVerified: 1, // B
          notReproduced: 0,
          candidate: 1, // Demo
          falsePositive: 1, // B
        },
        releases: {
          active: 0, // A's active release NOT leaked
          queued: 1, // B
        },
        alerts: {
          open: 1, // B's warning alert (A's critical alert NOT leaked)
          critical: 0, // A's critical alert NOT leaked
        },
      });

      // 7. Query stats as Admin: sees aggregate of ALL projects (A + B + Demo)
      const statsResAdmin = await app.inject({
        method: "GET",
        url: "/v1/stats",
        headers: { authorization: `Bearer ${tokenAdmin}` },
      });
      expect(statsResAdmin.statusCode).toBe(200);
      expect(statsResAdmin.json()).toEqual({
        projects: 3, // Project A + Project B + Demo
        jobs: {
          QUEUED: 1,
          RUNNING: 1,
          COMPLETED: 1,
          FAILED: 0,
          CANCELLED: 0,
        },
        findings: {
          reproduced: 1,
          fixedVerified: 1,
          notReproduced: 0,
          candidate: 1,
          falsePositive: 1,
        },
        releases: {
          active: 1,
          queued: 1,
        },
        alerts: {
          open: 2, // A (critical) + B (warning)
          critical: 1, // A (critical)
        },
      });

      // 8. Re-verify scoped token rejection (403 TOKEN_SCOPE) and unauthenticated rejection (401)
      const { token: scopedTokenA } = await createApiToken(db, userA!.id, "user-a-scoped", projectA!.id);
      const scopedRes = await app.inject({
        method: "GET",
        url: "/v1/stats",
        headers: { authorization: `Bearer ${scopedTokenA}` },
      });
      expect(scopedRes.statusCode).toBe(403);
      expect(scopedRes.json().error.code).toBe("TOKEN_SCOPE");

      const unauthRes = await app.inject({
        method: "GET",
        url: "/v1/stats",
      });
      expect(unauthRes.statusCode).toBe(401);
    } finally {
      await app.close();
      await db.close();
    }
  });

  it("rejects invalid SIWE attempts (expired nonce, expired message, wrong domain, wrong signer) and rejects expired or revoked sessions", async () => {
    let currentTime = new Date("2026-11-05T12:00:00.000Z");
    const db = await openDb({ memory: true });
    const cfg = loadConfig({
      DATA_DIR: ".pramaan/test-siwe-neg",
      RATE_LIMIT_PUBLIC_MAX: "10000",
      RATE_LIMIT_AUTH_MAX: "10000",
      SESSION_TTL_HOURS: "24",
    });

    const app = await createApp({
      db,
      cfg,
      skipBootstrap: true,
      deps: { now: () => currentTime },
    });

    try {
      const privateKey1 = generatePrivateKey();
      const account1 = privateKeyToAccount(privateKey1);

      // --- 1. Expired server nonce (NONCE_TTL_MS = 10 minutes) ---
      const nonceRes1 = await app.inject({ method: "GET", url: "/v1/auth/nonce" });
      expect(nonceRes1.statusCode).toBe(200);
      const { nonce: nonce1 } = nonceRes1.json<{ nonce: string }>();

      // Advance clock past 10 minutes (11 minutes)
      currentTime = new Date(currentTime.getTime() + 11 * 60_000);

      const msgExpiredNonce = createSiweMessage({
        address: account1.address,
        chainId: 1,
        domain: "127.0.0.1:5173",
        uri: "http://127.0.0.1:5173",
        nonce: nonce1,
        version: "1",
        statement: "Sign in to Pramaan",
        issuedAt: currentTime,
        expirationTime: new Date(currentTime.getTime() + 10 * 60_000),
      });
      const sigExpiredNonce = await account1.signMessage({ message: msgExpiredNonce });

      const resExpiredNonce = await app.inject({
        method: "POST",
        url: "/v1/auth/siwe",
        payload: { message: msgExpiredNonce, signature: sigExpiredNonce },
      });
      expect(resExpiredNonce.statusCode).toBe(401);
      expect(resExpiredNonce.json().error.code).toBe("SIWE_NONCE");

      // --- 2. Expired SIWE message ---
      currentTime = new Date("2026-11-05T13:00:00.000Z");
      const nonceRes2 = await app.inject({ method: "GET", url: "/v1/auth/nonce" });
      const { nonce: nonce2 } = nonceRes2.json<{ nonce: string }>();

      const msgExpiredMsg = createSiweMessage({
        address: account1.address,
        chainId: 1,
        domain: "127.0.0.1:5173",
        uri: "http://127.0.0.1:5173",
        nonce: nonce2,
        version: "1",
        statement: "Sign in to Pramaan",
        issuedAt: currentTime,
        expirationTime: new Date(currentTime.getTime() + 2 * 60_000),
      });
      const sigExpiredMsg = await account1.signMessage({ message: msgExpiredMsg });

      // Advance clock past message expirationTime (5 minutes later)
      currentTime = new Date(currentTime.getTime() + 5 * 60_000);

      const resExpiredMsg = await app.inject({
        method: "POST",
        url: "/v1/auth/siwe",
        payload: { message: msgExpiredMsg, signature: sigExpiredMsg },
      });
      expect(resExpiredMsg.statusCode).toBe(401);
      expect(resExpiredMsg.json().error.code).toBe("SIWE_INVALID");

      // --- 3. Wrong domain (not in cfg.siweDomains) ---
      currentTime = new Date("2026-11-05T14:00:00.000Z");
      const nonceRes3 = await app.inject({ method: "GET", url: "/v1/auth/nonce" });
      const { nonce: nonce3 } = nonceRes3.json<{ nonce: string }>();

      const msgWrongDomain = createSiweMessage({
        address: account1.address,
        chainId: 1,
        domain: "evil-phishing.org",
        uri: "http://evil-phishing.org",
        nonce: nonce3,
        version: "1",
        statement: "Sign in to Pramaan",
        issuedAt: currentTime,
        expirationTime: new Date(currentTime.getTime() + 10 * 60_000),
      });
      const sigWrongDomain = await account1.signMessage({ message: msgWrongDomain });

      const resWrongDomain = await app.inject({
        method: "POST",
        url: "/v1/auth/siwe",
        payload: { message: msgWrongDomain, signature: sigWrongDomain },
      });
      expect(resWrongDomain.statusCode).toBe(401);
      expect(resWrongDomain.json().error.code).toBe("SIWE_DOMAIN");

      // --- 4. Wrong recovered signer (message specifies account1, signed by account2) ---
      currentTime = new Date("2026-11-05T15:00:00.000Z");
      const nonceRes4 = await app.inject({ method: "GET", url: "/v1/auth/nonce" });
      const { nonce: nonce4 } = nonceRes4.json<{ nonce: string }>();

      const account2 = privateKeyToAccount(generatePrivateKey());
      const msgWrongSigner = createSiweMessage({
        address: account1.address,
        chainId: 1,
        domain: "127.0.0.1:5173",
        uri: "http://127.0.0.1:5173",
        nonce: nonce4,
        version: "1",
        statement: "Sign in to Pramaan",
        issuedAt: currentTime,
        expirationTime: new Date(currentTime.getTime() + 10 * 60_000),
      });
      const sigWrongSigner = await account2.signMessage({ message: msgWrongSigner });

      const resWrongSigner = await app.inject({
        method: "POST",
        url: "/v1/auth/siwe",
        payload: { message: msgWrongSigner, signature: sigWrongSigner },
      });
      expect(resWrongSigner.statusCode).toBe(401);
      expect(resWrongSigner.json().error.code).toBe("SIWE_SIGNATURE");

      // --- 5. Valid SIWE login followed by expired session ---
      currentTime = new Date("2026-11-05T16:00:00.000Z");
      const nonceRes5 = await app.inject({ method: "GET", url: "/v1/auth/nonce" });
      const { nonce: nonce5 } = nonceRes5.json<{ nonce: string }>();

      const validMsg = createSiweMessage({
        address: account1.address,
        chainId: 1,
        domain: "127.0.0.1:5173",
        uri: "http://127.0.0.1:5173",
        nonce: nonce5,
        version: "1",
        statement: "Sign in to Pramaan",
        issuedAt: currentTime,
        expirationTime: new Date(currentTime.getTime() + 10 * 60_000),
      });
      const validSig = await account1.signMessage({ message: validMsg });

      const loginRes = await app.inject({
        method: "POST",
        url: "/v1/auth/siwe",
        payload: { message: validMsg, signature: validSig },
      });
      expect(loginRes.statusCode).toBe(200);
      const sessionCookie = loginRes.cookies.find((c) => c.name === "pramaan_session")!;
      const cookieHeader = `pramaan_session=${sessionCookie.value}`;

      // Session is valid initially
      const meResBefore = await app.inject({
        method: "GET",
        url: "/v1/me",
        headers: { cookie: cookieHeader },
      });
      expect(meResBefore.statusCode).toBe(200);

      // Advance clock past session TTL (24 hours + 1 hour)
      currentTime = new Date(currentTime.getTime() + 25 * 3600_000);

      // Expired session rejected with 401
      const meResExpired = await app.inject({
        method: "GET",
        url: "/v1/me",
        headers: { cookie: cookieHeader },
      });
      expect(meResExpired.statusCode).toBe(401);

      // --- 6. Revoked session rejected ---
      currentTime = new Date("2026-11-05T18:00:00.000Z");
      const nonceRes6 = await app.inject({ method: "GET", url: "/v1/auth/nonce" });
      const { nonce: nonce6 } = nonceRes6.json<{ nonce: string }>();

      const msgRevoke = createSiweMessage({
        address: account2.address,
        chainId: 1,
        domain: "127.0.0.1:5173",
        uri: "http://127.0.0.1:5173",
        nonce: nonce6,
        version: "1",
        statement: "Sign in to Pramaan",
        issuedAt: currentTime,
      });
      const sigRevoke = await account2.signMessage({ message: msgRevoke });

      const loginRes2 = await app.inject({
        method: "POST",
        url: "/v1/auth/siwe",
        payload: { message: msgRevoke, signature: sigRevoke },
      });
      expect(loginRes2.statusCode).toBe(200);
      const cookieHeader2 = `pramaan_session=${loginRes2.cookies.find((c) => c.name === "pramaan_session")!.value}`;
      const csrf2 = loginRes2.json<{ csrfToken: string }>().csrfToken;

      const meActive = await app.inject({
        method: "GET",
        url: "/v1/me",
        headers: { cookie: cookieHeader2 },
      });
      expect(meActive.statusCode).toBe(200);

      // Logout revokes session
      const logoutRes = await app.inject({
        method: "POST",
        url: "/v1/auth/logout",
        headers: { cookie: cookieHeader2, "x-pramaan-csrf": csrf2 },
      });
      expect(logoutRes.statusCode).toBe(200);

      // Revoked session rejected with 401
      const meRevoked = await app.inject({
        method: "GET",
        url: "/v1/me",
        headers: { cookie: cookieHeader2 },
      });
      expect(meRevoked.statusCode).toBe(401);
    } finally {
      await app.close();
      await db.close();
    }
  });

  it("wraps project INSERT, owner membership, and audit log in a single transaction", async () => {
    const db = await openDb({ memory: true });
    const cfg = loadConfig({
      DATA_DIR: ".pramaan/test-project-tx",
      RATE_LIMIT_PUBLIC_MAX: "10000",
      RATE_LIMIT_AUTH_MAX: "10000",
    });

    const app = await createApp({ db, cfg, skipBootstrap: true });
    try {
      const user = await db.one<{ id: string }>(
        "INSERT INTO users (display_name, is_admin) VALUES ('tx-user', false) RETURNING id",
      );
      const { token } = await createApiToken(db, user!.id, "tx-user-pat", null);

      // 1. Successful project creation executes project INSERT + owner membership + audit atomically
      const okRes = await app.inject({
        method: "POST",
        url: "/v1/projects",
        headers: { authorization: `Bearer ${token}` },
        payload: { name: "Atomic Project", domain: "atomic.example.com" },
      });
      expect(okRes.statusCode).toBe(201);
      const created = okRes.json<{ id: string; name: string; role: string; domain: string }>();
      expect(created.name).toBe("Atomic Project");
      expect(created.domain).toBe("atomic.example.com");
      expect(created.role).toBe("owner");

      // Verify owner membership row
      const member = await db.one<{ role: string }>(
        "SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2",
        [created.id, user!.id],
      );
      expect(member?.role).toBe("owner");

      // Verify audit row
      const auditRow = await db.one<{ action: string; target: string }>(
        "SELECT action, target FROM audit_log WHERE project_id = $1",
        [created.id],
      );
      expect(auditRow?.action).toBe("project.create");
      expect(auditRow?.target).toBe("Atomic Project");

      // 2. Failure within Db.tx rolls back completely and leaves no orphan project
      const countBefore = Number((await db.one<{ count: string | number }>("SELECT COUNT(*)::int AS count FROM projects"))?.count ?? 0);

      await expect(
        db.tx(async (tx) => {
          await tx.query(
            "INSERT INTO projects (slug, name) VALUES ('doomed-slug', 'Doomed Project')",
          );
          throw new Error("simulated failure during project creation transaction");
        }),
      ).rejects.toThrow("simulated failure during project creation transaction");

      const countAfter = Number((await db.one<{ count: string | number }>("SELECT COUNT(*)::int AS count FROM projects"))?.count ?? 0);
      expect(countAfter).toBe(countBefore);

      const doomed = await db.one("SELECT 1 FROM projects WHERE slug = 'doomed-slug'");
      expect(doomed).toBeNull();
    } finally {
      await app.close();
      await db.close();
    }
  });
});
