import { createHmac } from "node:crypto";
import { rmSync } from "node:fs";
import { buildManifest, generateReleaseKey, manifestDigest, releaseStatement, sha256Hex, signStatementWithKey, sriSha384, base64Encode } from "@pramaan/manifest/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createApiToken } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { openDb, type Db } from "../src/db.js";
import { claimJob, type JobRow } from "../src/queue.js";
import { storeFinding } from "../src/worker.js";

type App = Awaited<ReturnType<typeof createApp>>;

const WEBHOOK_SECRET = "webhook-secret-for-tests-123456";
const DATA_DIR = ".pramaan/test-jobs-findings-releases";
const ghCalls: { method: string; url: string; body?: unknown }[] = [];

let db: Db;
let app: App;
let token: string;
let other: string;
let projectId: string;

const auth = (t = token) => ({ authorization: `Bearer ${t}` });

function stubGithub(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    ghCalls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
    if (url.endsWith("/repos/acme/vault")) return json({ default_branch: "main" });
    if (url.includes("/git/trees/")) return json({ tree: [{ path: "contracts/src/Vault.sol", type: "blob" }, { path: "README.md", type: "blob" }] });
    if (url.endsWith("/git/refs")) return json({ ref: "ok" }, 201);
    if (url.includes("/contents/")) return method === "PUT" ? json({ content: {} }) : json({ sha: "blobsha" });
    if (url.endsWith("/pulls")) return json({ html_url: "https://github.com/acme/vault/pull/7" }, 201);
    return json({ message: "unexpected" }, 404);
  }) as typeof fetch;
}

beforeAll(async () => {
  rmSync(DATA_DIR, { recursive: true, force: true });
  db = await openDb({ memory: true });
  const cfg = loadConfig({ DATA_DIR, RATE_LIMIT_MAX: "100000", RATE_LIMIT_PUBLIC_MAX: "100000", GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET, GITHUB_TOKEN: "ghp_testtoken_1234567890", GITHUB_API_URL: "https://api.github.test", ALLOW_PRIVATE_NETWORK: "1" });
  app = await createApp({
    db,
    cfg,
    skipBootstrap: true,
    deps: { fetch: stubGithub(), verifySite: (async (i: { origin: string }) => ({ status: "verified", origin: i.origin })) as never },
  });
  const user = (await db.one<{ id: string }>("INSERT INTO users (display_name, is_admin) VALUES ('owner', false) RETURNING id"))!;
  const stranger = (await db.one<{ id: string }>("INSERT INTO users (display_name, is_admin) VALUES ('stranger', false) RETURNING id"))!;
  token = (await createApiToken(db, user.id, "t", null)).token;
  other = (await createApiToken(db, stranger.id, "t", null)).token;
  const p = (await db.one<{ id: string }>("INSERT INTO projects (slug, name, ens_name, repo_url) VALUES ('vault', 'Vault', 'vault.eth', 'https://github.com/acme/vault') RETURNING id"))!;
  projectId = p.id;
  await db.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1,$2,'owner')", [projectId, user.id]);
}, 180_000);

afterAll(async () => {
  await app?.close();
  await db.close();
  rmSync(DATA_DIR, { recursive: true, force: true });
});

describe("analysis jobs", () => {
  it("queues, de-duplicates, lists, reads events and cancels a job; rejects bad sources and strangers", async () => {
    const bad = await app.inject({ method: "POST", url: `/v1/projects/${projectId}/jobs`, headers: auth(), payload: { source: { type: "github", url: "https://evil.example/acme/vault" } } });
    expect(bad.statusCode).toBe(400);
    const creds = await app.inject({ method: "POST", url: `/v1/projects/${projectId}/jobs`, headers: auth(), payload: { source: { type: "github", url: "https://user:pw@github.com/acme/vault" } } });
    expect(creds.statusCode).toBe(400);
    const denied = await app.inject({ method: "POST", url: `/v1/projects/${projectId}/jobs`, headers: auth(other), payload: { source: { type: "example", name: "reentrancy-bank" } } });
    expect(denied.statusCode).toBe(403);

    const payload = { source: { type: "example", name: "reentrancy-bank" }, params: { fix: true } };
    const a = await app.inject({ method: "POST", url: `/v1/projects/${projectId}/jobs`, headers: auth(), payload });
    expect(a.statusCode).toBe(201);
    expect(a.json().job).toMatchObject({ kind: "analyze", status: "QUEUED", params: { fix: true } });
    const b = await app.inject({ method: "POST", url: `/v1/projects/${projectId}/jobs`, headers: auth(), payload });
    expect(b.json().deduplicated).toBe(true);
    expect(b.json().job.id).toBe(a.json().job.id);

    const jobId = a.json().job.id as string;
    expect((await app.inject({ method: "GET", url: `/v1/jobs/${jobId}`, headers: auth() })).json().id).toBe(jobId);
    expect((await app.inject({ method: "GET", url: `/v1/projects/${projectId}/jobs`, headers: auth() })).json()).toHaveLength(1);
    expect((await app.inject({ method: "GET", url: `/v1/jobs/${jobId}`, headers: auth(other) })).statusCode).toBe(403);

    await db.query("INSERT INTO job_events (job_id, seq, step, status, message) VALUES ($1,1,'source','completed','ok'), ($1,2,'scan','running','slither')", [jobId]);
    const ev = await app.inject({ method: "GET", url: `/v1/jobs/${jobId}/events?after=1`, headers: auth() });
    expect(ev.json()).toMatchObject([{ seq: 2, step: "scan" }]);

    const cancelled = await app.inject({ method: "POST", url: `/v1/jobs/${jobId}/cancel`, headers: auth() });
    expect(cancelled.json().status).toBe("CANCELLED");
    // a cancelled job is never claimed by a worker
    expect(await claimJob(db, "test-worker")).toBeNull();

    const sse = await app.inject({ method: "GET", url: `/v1/jobs/${jobId}/stream`, headers: auth() });
    expect(sse.headers["content-type"]).toContain("text/event-stream");
    expect(sse.body).toContain("event: progress");
    expect(sse.body).toContain('"status":"CANCELLED"');
  });

  it("rejects an upload that is not a zip", async () => {
    const boundary = "----pramaantest";
    const body = `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="x.zip"\r\ncontent-type: application/zip\r\n\r\nnot a zip\r\n--${boundary}--\r\n`;
    const res = await app.inject({ method: "POST", url: `/v1/projects/${projectId}/uploads`, headers: { ...auth(), "content-type": `multipart/form-data; boundary=${boundary}` }, payload: body });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("BAD_ARCHIVE");
  });
});

describe("findings and fixes", () => {
  let findingId: string;
  let fixId: string;

  beforeAll(async () => {
    const job = (await db.one<{ id: string }>(
      `INSERT INTO analysis_jobs (project_id, kind, status, source, toolchain_hash, request_hash, idempotency_key, commit_sha)
       VALUES ($1,'analyze','COMPLETED',$2,'t','r','findings-seed',$3) RETURNING id`,
      [projectId, JSON.stringify({ type: "github", url: "https://github.com/acme/vault", ref: "a".repeat(40) }), "a".repeat(40)],
    ))!;
    const f = (await db.one<{ id: string }>(
      `INSERT INTO findings (project_id, job_id, label, finding_key, vuln_class, title, severity, confidence, status, contract, function_sig, file, lines, sources, engine_result)
       VALUES ($1,$2,'PRM-1','k1','access-control','withdrawAll has no access control','critical','high','reproduced','Vault','withdrawAll()','src/Vault.sol','{10,12}','[]','{}') RETURNING id`,
      [projectId, job.id],
    ))!;
    findingId = f.id;
    await db.query("INSERT INTO exploit_tests (finding_id, file_name, contract_name, source, sha256) VALUES ($1,'Exploit.t.sol','ExploitTest','contract X {}',$2)", [findingId, "b".repeat(64)]);
    await db.query("INSERT INTO evidence (finding_id, sha256, body) VALUES ($1,$2,'{\"a\":1}')", [findingId, "c".repeat(64)]);
    fixId = (await db.one<{ id: string }>(
      `INSERT INTO fix_proposals (finding_id, generator, file, diff, after_source, change, explanation, status, verification, job_id)
       VALUES ($1,'deterministic','src/Vault.sol','-a\n+b','contract Fixed {}','add onlyOwner','Adds an owner check','verified','{"verified":true}',$2) RETURNING id`,
      [findingId, job.id],
    ))!.id;
  });

  it("lists, filters and shows a finding with its exploit test, evidence and fix", async () => {
    const list = await app.inject({ method: "GET", url: `/v1/projects/${projectId}/findings?status=reproduced`, headers: auth() });
    expect(list.json()).toHaveLength(1);
    const d = (await app.inject({ method: "GET", url: `/v1/findings/${findingId}`, headers: auth() })).json();
    expect(d).toMatchObject({ label: "PRM-1", severity: "critical", exploitTest: { fileName: "Exploit.t.sol" }, evidence: [{ sha256: "c".repeat(64) }], fixes: [{ status: "verified", generator: "deterministic" }] });
    expect((await app.inject({ method: "GET", url: `/v1/findings/${findingId}`, headers: auth(other) })).statusCode).toBe(403);
    const ev = await app.inject({ method: "GET", url: `/v1/findings/${findingId}/evidence/${"c".repeat(64)}`, headers: auth() });
    expect(ev.body).toBe('{"a":1}');
  });

  it("queues a fix job only for a reproduced finding", async () => {
    const ok = await app.inject({ method: "POST", url: `/v1/findings/${findingId}/fix`, headers: auth(), payload: {} });
    expect(ok.statusCode).toBe(202);
    expect(ok.json().job).toMatchObject({ kind: "fix", params: { findingId } });
    await db.query("UPDATE findings SET status = 'candidate' WHERE id = $1", [findingId]);
    const no = await app.inject({ method: "POST", url: `/v1/findings/${findingId}/fix`, headers: auth(), payload: {} });
    expect(no.statusCode).toBe(409);
    expect(no.json().error.code).toBe("NOT_REPRODUCED");
    await db.query("UPDATE findings SET status = 'reproduced' WHERE id = $1", [findingId]);
  });

  it("opens a pull request for a verified fix on a new branch and never merges", async () => {
    ghCalls.length = 0;
    const res = await app.inject({ method: "POST", url: `/v1/fixes/${fixId}/pull-request`, headers: auth(), payload: {} });
    expect(res.statusCode).toBe(201);
    expect(res.json().url).toBe("https://github.com/acme/vault/pull/7");
    const ref = ghCalls.find((c) => c.url.endsWith("/git/refs"));
    expect((ref!.body as { ref: string }).ref).toMatch(/^refs\/heads\/pramaan\/fix-prm-1-/);
    const put = ghCalls.find((c) => c.method === "PUT");
    expect(put!.url).toContain("/contents/contracts/src/Vault.sol");
    expect(Buffer.from((put!.body as { content: string }).content, "base64").toString()).toBe("contract Fixed {}");
    expect(ghCalls.some((c) => /merge/.test(c.url))).toBe(false);
    // second call is idempotent and does not touch GitHub again
    ghCalls.length = 0;
    const again = await app.inject({ method: "POST", url: `/v1/fixes/${fixId}/pull-request`, headers: auth(), payload: {} });
    expect(again.json().url).toBe("https://github.com/acme/vault/pull/7");
    expect(ghCalls).toHaveLength(0);
  });

  it("refuses a pull request for an unverified fix", async () => {
    const bad = (await db.one<{ id: string }>(
      `INSERT INTO fix_proposals (finding_id, generator, file, diff, after_source, explanation, status) VALUES ($1,'ai','src/Vault.sol','d','x','e','failed') RETURNING id`,
      [findingId],
    ))!;
    const res = await app.inject({ method: "POST", url: `/v1/fixes/${bad.id}/pull-request`, headers: auth(), payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("FIX_NOT_VERIFIED");
  });

  it("records a false-positive review which overrides the displayed status", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/findings/${findingId}/review`, headers: auth(), payload: { decision: "false-positive", note: "guarded elsewhere" } });
    expect(r.json()).toMatchObject({ status: "false-positive", review: { decision: "false-positive", note: "guarded elsewhere" } });
    const stats = await app.inject({ method: "GET", url: "/v1/stats", headers: auth() });
    expect(stats.statusCode).toBe(200);
  });
});

describe("releases", () => {
  const manifest = () =>
    buildManifest({
      app: { name: "Vault", ensName: "vault.eth", domain: "https://vault.example" },
      repo: "https://github.com/acme/vault",
      commit: "0123456789abcdef0123456789abcdef01234567",
      tag: "v1.0.0",
      workflow: ".github/workflows/pramaan-release.yml",
      builtAt: "2026-11-04T10:00:00Z",
      files: [{ path: "/index.html", sha256: sha256Hex("<html></html>"), sri: sriSha384("<html></html>") }],
      contracts: [{ label: "VaultV2", chainId: 11155111, address: "0x1111111111111111111111111111111111111111", runtimeCodehash: `0x${"aa".repeat(32)}`, proxy: null, sourcify: { status: "exact_match" } }],
    });

  it("stores a signed release, serves its canonical bytes from the public mirror, and rejects forgeries", async () => {
    const m = manifest();
    const digest = manifestDigest(m);
    const key = await generateReleaseKey();
    const sig = await signStatementWithKey(releaseStatement(digest, { tag: m.tag }), key.privateKeyPkcs8Pem);
    const created = await app.inject({ method: "POST", url: `/v1/projects/${projectId}/releases`, headers: auth(), payload: { manifest: m, signature: sig, signerSpki: key.signerRecord } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ tag: "v1.0.0", sha256: digest, signatureStatus: "verified", status: "signed", pointer: `pramaan:v1:v1.0.0:${digest}` });

    const mirror = await app.inject({ method: "GET", url: `/v1/mirror/${digest}` });
    expect(mirror.statusCode).toBe(200);
    expect(sha256Hex(mirror.rawPayload)).toBe(digest);
    expect(mirror.headers["cache-control"]).toContain("immutable");
    expect((await app.inject({ method: "GET", url: `/v1/mirror/${"0".repeat(64)}` })).statusCode).toBe(404);

    const detail = (await app.inject({ method: "GET", url: `/v1/releases/${created.json().id}`, headers: auth() })).json();
    expect(detail.manifest.app.ensName).toBe("vault.eth");
    expect(await db.query("SELECT 1 FROM artifacts WHERE release_id = $1", [created.json().id])).toHaveLength(1);
    expect(await db.query("SELECT 1 FROM release_contracts WHERE release_id = $1", [created.json().id])).toHaveLength(1);

    // same tag again
    const dup = await app.inject({ method: "POST", url: `/v1/projects/${projectId}/releases`, headers: auth(), payload: { manifest: m } });
    expect(dup.statusCode).toBe(409);

    // a signature made over a different manifest, or by a different key, is refused
    const m2 = { ...manifest(), tag: "v1.0.1" };
    const wrongDigest = await app.inject({ method: "POST", url: `/v1/projects/${projectId}/releases`, headers: auth(), payload: { manifest: m2, signature: sig, signerSpki: key.signerRecord } });
    expect(wrongDigest.statusCode).toBe(400);
    expect(wrongDigest.json().error.code).toBe("SIGNATURE_INVALID");
    const otherKey = await generateReleaseKey();
    const wrongKey = await app.inject({ method: "POST", url: `/v1/projects/${projectId}/releases`, headers: auth(), payload: { manifest: m2, signature: sig, signerSpki: otherKey.signerRecord } });
    expect(wrongKey.json().error.code).toBe("SIGNATURE_INVALID");
    void base64Encode;

    // a manifest naming another ENS name is refused for this project
    const foreign = { ...manifest(), tag: "v9", app: { name: "X", ensName: "evil.eth", domain: "https://vault.example" } };
    expect((await app.inject({ method: "POST", url: `/v1/projects/${projectId}/releases`, headers: auth(), payload: { manifest: foreign } })).json().error.code).toBe("ENS_MISMATCH");
    expect((await app.inject({ method: "POST", url: `/v1/projects/${projectId}/releases`, headers: auth(), payload: { manifest: { nope: true } } })).json().error.code).toBe("MANIFEST_INVALID");
  });

  it("answers 501 for chain actions that are not configured, never a fake success", async () => {
    const list = (await app.inject({ method: "GET", url: `/v1/projects/${projectId}/releases`, headers: auth() })).json();
    const q = await app.inject({ method: "POST", url: `/v1/releases/${list[0].id}/queue`, headers: auth(), payload: {} });
    expect(q.statusCode).toBe(501);
    expect(q.json().error.code).toBe("PROPOSER_NOT_CONFIGURED");
    const ipfs = await app.inject({ method: "POST", url: `/v1/releases/${list[0].id}/ipfs`, headers: auth(), payload: {} });
    expect(ipfs.json().error.code).toBe("IPFS_NOT_CONFIGURED");
  });
});

describe("public verify and GitHub webhook", () => {
  it("verifies a site through the injected verifier (SSRF guard still applies in production mode)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/verify/site", payload: { url: "https://vault.example/app" } });
    // no VERIFY_RPC_URLS and no demo project: honest 501 instead of a fake verdict
    expect(res.statusCode).toBe(501);
    expect(res.json().error.code).toBe("NO_CHAINS");
    await db.query("INSERT INTO projects (slug, name, is_demo, chain_id, rpc_url) VALUES ('demo','Demo',true,31337,'http://127.0.0.1:8545')");
    const ok = await app.inject({ method: "POST", url: "/v1/verify/site", payload: { url: "https://vault.example/app" } });
    expect(ok.json()).toMatchObject({ status: "verified", origin: "https://vault.example" });
    expect((await app.inject({ method: "POST", url: "/v1/verify/site", payload: { url: "ftp://x" } })).statusCode).toBe(400);
  });

  const push = (after: string) => JSON.stringify({ after, repository: { html_url: "https://github.com/acme/vault" } });
  const sign = (body: string) => `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex")}`;

  it("rejects a bad signature, queues one analysis per pushed commit and ignores other events", async () => {
    const body = push("d".repeat(40));
    const bad = await app.inject({ method: "POST", url: "/v1/webhooks/github", headers: { "content-type": "application/json", "x-github-event": "push", "x-hub-signature-256": `sha256=${"0".repeat(64)}` }, payload: body });
    expect(bad.statusCode).toBe(401);
    const h = { "content-type": "application/json", "x-github-event": "push", "x-hub-signature-256": sign(body) };
    const first = await app.inject({ method: "POST", url: "/v1/webhooks/github", headers: h, payload: body });
    expect(first.statusCode).toBe(202);
    expect(first.json().jobs).toHaveLength(1);
    expect(first.json().jobs[0].deduplicated).toBe(false);
    const again = await app.inject({ method: "POST", url: "/v1/webhooks/github", headers: h, payload: body });
    expect(again.json().jobs[0]).toMatchObject({ deduplicated: true, jobId: first.json().jobs[0].jobId });
    const ping = await app.inject({ method: "POST", url: "/v1/webhooks/github", headers: { ...h, "x-github-event": "ping" }, payload: body });
    expect(ping.json()).toMatchObject({ event: "ping" });
    const issues = await app.inject({ method: "POST", url: "/v1/webhooks/github", headers: { ...h, "x-github-event": "issues" }, payload: body });
    expect(issues.statusCode).toBe(202);
  });
});

describe("worker persistence", () => {
  it("stores an engine finding with its raw engine result (engine_result is NOT NULL)", async () => {
    const job = (await db.one<JobRow>(
      `INSERT INTO analysis_jobs (project_id, kind, source, toolchain_hash, request_hash, idempotency_key) VALUES ($1,'analyze','{"type":"example","name":"contracts"}','t','r2','worker-seed') RETURNING *`,
      [projectId],
    ))!;
    const finding = {
      id: "PRM-9",
      candidate: { key: "k9", vulnClass: "reentrancy", title: "reentrant withdraw", severity: "high", confidence: "medium", contract: "Bank", function: "withdraw()", file: "src/Bank.sol", lines: [5], sources: [{ tool: "slither", detector: "reentrancy-eth" }] },
      templateId: null,
      plan: null,
      planError: "no template",
      test: null,
      gates: [],
      vulnerableRun: { result: "not-run", reason: null, logs: [], durationMs: null },
      status: "candidate",
      pairs: [],
    };
    const id = await storeFinding(db, job, { contracts: [] } as never, finding as never);
    const row = await db.one<{ engine_result: { id: string }; status: string }>("SELECT engine_result, status FROM findings WHERE id = $1", [id]);
    expect(row).toMatchObject({ status: "candidate", engine_result: { id: "PRM-9" } });
  });
});

describe("telegram test message", () => {
  it("answers 501 when Telegram is not configured instead of pretending to send", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/projects/${projectId}/alerts/test-telegram`, headers: auth(), payload: {} });
    expect(res.statusCode).toBe(501);
    expect(res.json().error.code).toBe("TELEGRAM_NOT_CONFIGURED");
  });

  it("sends through the Telegram API when configured and reports a rejection honestly", async () => {
    const calls: string[] = [];
    let answer = { ok: true } as Record<string, unknown>;
    let status = 200;
    const cfg = loadConfig({ DATA_DIR: DATA_DIR + "-tg", RATE_LIMIT_MAX: "100000", TELEGRAM_BOT_TOKEN: "123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", TELEGRAM_CHAT_ID: "42", TELEGRAM_API_URL: "https://tg.test" });
    const tg = await createApp({ db, cfg, skipBootstrap: true, deps: { sleep: async () => {}, fetch: (async (u: RequestInfo | URL) => { calls.push(String(u)); return new Response(JSON.stringify(answer), { status }); }) as typeof fetch } });
    try {
      const ok = await tg.inject({ method: "POST", url: `/v1/projects/${projectId}/alerts/test-telegram`, headers: auth(), payload: {} });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().delivery.telegram.status).toBe("sent");
      expect(calls[0]).toContain("/sendMessage");
      answer = { ok: false, description: "chat not found" };
      status = 400;
      const bad = await tg.inject({ method: "POST", url: `/v1/projects/${projectId}/alerts/test-telegram`, headers: auth(), payload: {} });
      expect(bad.statusCode).toBe(502);
      expect(bad.json().error.code).toBe("TELEGRAM_FAILED");
      expect(JSON.stringify(bad.json())).not.toContain("AAAAAAAAAA");
    } finally {
      await tg.close();
    }
  });
});
