import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  base64Decode,
  encodePointer,
  keyIdForSpki,
  ManifestV1,
  manifestBytes,
  rawCidForBytes,
  sha256Hex,
  spkiFromSignerRecord,
  statementCoversDigest,
  verifyEnvelopeWithKey,
  type DsseEnvelope,
} from "@pramaan/manifest";
import { connect, executeOp, publishToIpfs, queuePointer, signerFromKey, timelockAbi, TIMELOCK_STATE } from "@pramaan/release";
import { assertRole, audit, requireUser, type AuthUser } from "../auth.js";
import type { Ctx } from "../context.js";
import { badRequest, conflict, HttpError, notConfigured, notFound, parse } from "../errors.js";
import { assertSafeHttpUrl } from "../net.js";

const IdParams = z.object({ id: z.string().uuid("invalid id") });
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

interface ReleaseRow {
  id: string;
  project_id: string;
  tag: string;
  commit_sha: string | null;
  manifest: unknown;
  manifest_sha256: string;
  pointer: string;
  cid: string | null;
  signature_status: string;
  signature_detail: string | null;
  storage: Record<string, unknown> | null;
  timelock_op_id: string | null;
  queue_tx: string | null;
  execute_tx: string | null;
  eta: Date | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

const releaseDto = (r: ReleaseRow) => ({
  id: r.id,
  projectId: r.project_id,
  tag: r.tag,
  sha256: r.manifest_sha256,
  pointer: r.pointer,
  cid: r.cid,
  signatureStatus: r.signature_status,
  signatureDetail: r.signature_detail,
  storage: r.storage,
  timelockOpId: r.timelock_op_id,
  eta: iso(r.eta),
  queueTx: r.queue_tx,
  executeTx: r.execute_tx,
  status: r.status,
  commitSha: r.commit_sha,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

const CreateReleaseSchema = z.object({
  manifest: z.unknown(),
  /** DSSE envelope over an in-toto statement for the manifest digest (see `pramaan sign`). */
  signature: z.object({ payloadType: z.string(), payload: z.string(), signatures: z.array(z.object({ keyid: z.string().optional(), sig: z.string() })).min(1) }).optional(),
  /** The release signer's public key: base64 SPKI, or the `p256-spki:` value stored in the ENS name's `pramaan.signer` record. */
  signerSpki: z.string().max(400).optional(),
});

function decodeSpki(value: string): Uint8Array {
  return value.startsWith("p256-spki:") ? spkiFromSignerRecord(value) : base64Decode(value);
}

export function registerReleaseRoutes(app: FastifyInstance, ctx: Ctx): void {
  async function loadRelease(user: AuthUser | null, id: string, min: "viewer" | "maintainer") {
    const r = await ctx.db.one<ReleaseRow>("SELECT * FROM releases WHERE id = $1", [id]);
    if (!r) throw notFound("release");
    await assertRole(ctx.db, user, r.project_id, min);
    return r;
  }

  app.get("/v1/projects/:id/releases", async (req) => {
    const user = requireUser(req.user);
    const { id } = parse(IdParams, req.params, "project params");
    await assertRole(ctx.db, user, id, "viewer");
    const rows = await ctx.db.query<ReleaseRow>("SELECT * FROM releases WHERE project_id = $1 ORDER BY created_at DESC LIMIT 200", [id]);
    return rows.map(releaseDto);
  });

  app.post("/v1/projects/:id/releases", async (req, reply) => {
    const user = requireUser(req.user);
    const { id } = parse(IdParams, req.params, "project params");
    await assertRole(ctx.db, user, id, "maintainer");
    const body = parse(CreateReleaseSchema, req.body, "release body");

    const parsed = ManifestV1.safeParse(body.manifest);
    if (!parsed.success) throw badRequest(`manifest does not match schema v1: ${parsed.error.issues[0]?.message ?? "invalid"}`, "MANIFEST_INVALID");
    const manifest = parsed.data;
    const project = await ctx.db.one<{ ens_name: string | null }>("SELECT ens_name FROM projects WHERE id = $1", [id]);
    if (project?.ens_name && project.ens_name.toLowerCase() !== manifest.app.ensName.toLowerCase()) {
      throw badRequest(`manifest names ${manifest.app.ensName} but this project is ${project.ens_name}`, "ENS_MISMATCH");
    }
    // The server canonicalizes: the published bytes and their hash never depend on how the client formatted the JSON.
    const bytes = manifestBytes(manifest);
    const sha256 = sha256Hex(bytes);
    const pointer = encodePointer(manifest.tag, sha256);
    const cid = rawCidForBytes(bytes);

    let signatureStatus: "verified" | "invalid" | "unsigned" = "unsigned";
    let detail: string | null = "no signature supplied";
    let keyId: string | null = null;
    if (body.signature) {
      if (!body.signerSpki) throw badRequest("signerSpki is required with a signature", "SIGNER_REQUIRED");
      let spki: Uint8Array;
      try {
        spki = decodeSpki(body.signerSpki);
      } catch (err) {
        throw badRequest((err as Error).message, "SIGNER_INVALID");
      }
      const v = await verifyEnvelopeWithKey(body.signature as DsseEnvelope, spki);
      if (!v.ok) {
        signatureStatus = "invalid";
        detail = v.reason;
      } else if (!statementCoversDigest(v.statement, sha256)) {
        signatureStatus = "invalid";
        detail = "the signed statement does not cover this manifest's sha256";
      } else {
        signatureStatus = "verified";
        detail = null;
        keyId = keyIdForSpki(spki);
      }
      if (signatureStatus === "invalid") throw badRequest(`signature rejected: ${detail}`, "SIGNATURE_INVALID");
    }

    const dup = await ctx.db.one<{ id: string }>("SELECT id FROM releases WHERE project_id = $1 AND (tag = $2 OR manifest_sha256 = $3)", [id, manifest.tag, sha256]);
    if (dup) throw conflict("this tag or manifest already exists for the project", "RELEASE_EXISTS", { releaseId: dup.id });

    const row = await ctx.db.tx(async (t) => {
      const r = await t.one<ReleaseRow>(
        `INSERT INTO releases (project_id, tag, commit_sha, manifest, manifest_bytes, manifest_sha256, pointer, cid, signature, signature_status, signature_detail, signer_key_id, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [id, manifest.tag, manifest.commit, JSON.stringify(manifest), Buffer.from(bytes), sha256, pointer, cid, body.signature ? JSON.stringify(body.signature) : null, signatureStatus, detail, keyId, signatureStatus === "verified" ? "signed" : "draft", user.id],
      );
      for (const f of manifest.files) await t.query("INSERT INTO artifacts (release_id, path, sha256, sri) VALUES ($1,$2,$3,$4)", [r!.id, f.path, f.sha256, f.sri]);
      for (const c of manifest.contracts) {
        await t.query(
          `INSERT INTO release_contracts (release_id, label, chain_id, address, runtime_codehash, proxy_type, impl_address, impl_codehash, sourcify_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [r!.id, c.label, c.chainId, c.address, c.runtimeCodehash, c.proxy?.type ?? null, c.proxy?.implAddress ?? null, c.proxy?.implCodehash ?? null, c.sourcify.status],
        );
      }
      await audit(t, user.id, id, "release.create", r!.id, { tag: manifest.tag, sha256, signature: signatureStatus });
      return r!;
    });
    return reply.code(201).send(releaseDto(row));
  });

  app.get("/v1/releases/:id", async (req) => {
    const user = requireUser(req.user);
    const { id } = parse(IdParams, req.params, "release params");
    const r = await loadRelease(user, id, "viewer");
    return { ...releaseDto(r), manifest: r.manifest };
  });

  app.get("/v1/releases/:id/manifest", async (req, reply) => {
    const user = requireUser(req.user);
    const { id } = parse(IdParams, req.params, "release params");
    await loadRelease(user, id, "viewer");
    const row = await ctx.db.one<{ manifest_bytes: Buffer }>("SELECT manifest_bytes FROM releases WHERE id = $1", [id]);
    return reply.header("content-type", "application/json; charset=utf-8").send(Buffer.from(row!.manifest_bytes));
  });

  /** Public and immutable: the manifest is trusted because its sha256 is in ENS, not because of where it was served from. */
  app.get("/v1/mirror/:sha256", async (req, reply) => {
    const { sha256 } = parse(z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/) }), req.params, "mirror params");
    const row = await ctx.db.one<{ manifest_bytes: Buffer }>("SELECT manifest_bytes FROM releases WHERE manifest_sha256 = $1 LIMIT 1", [sha256]);
    if (!row) throw notFound("manifest");
    return reply
      .header("content-type", "application/json; charset=utf-8")
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("access-control-allow-origin", "*")
      .send(Buffer.from(row.manifest_bytes));
  });

  const chainFor = async (r: ReleaseRow) => {
    const p = await ctx.db.one<{ rpc_url: string | null; timelock_address: string | null }>("SELECT rpc_url, timelock_address FROM projects WHERE id = $1", [r.project_id]);
    if (!p?.rpc_url || !p.timelock_address) throw notConfigured("CHAIN_NOT_CONFIGURED", "set the project's RPC URL and timelock address first");
    await assertSafeHttpUrl(p.rpc_url, ctx.cfg.allowPrivateNetwork, "project RPC URL");
    return { chain: await connect(p.rpc_url), timelock: p.timelock_address as `0x${string}` };
  };

  app.post("/v1/releases/:id/ipfs", async (req) => {
    const user = requireUser(req.user);
    const { id } = parse(IdParams, req.params, "release params");
    const r = await loadRelease(user, id, "maintainer");
    if (!ctx.cfg.IPFS_API_URL && !ctx.cfg.PINATA_JWT) throw notConfigured("IPFS_NOT_CONFIGURED", "set IPFS_API_URL (Kubo) or PINATA_JWT on the server");
    const row = await ctx.db.one<{ manifest_bytes: Buffer }>("SELECT manifest_bytes FROM releases WHERE id = $1", [id]);
    const pub = await publishToIpfs(new Uint8Array(row!.manifest_bytes), { kuboApi: ctx.cfg.IPFS_API_URL, pinataJwt: ctx.cfg.PINATA_JWT, gateways: ctx.cfg.IPFS_GATEWAY_URL ? [ctx.cfg.IPFS_GATEWAY_URL] : [] });
    if (!pub.matchesPointer) throw new HttpError(502, "CID_MISMATCH", `the IPFS provider returned ${pub.cid}, not the expected ${pub.expectedCid}`);
    await ctx.db.query("UPDATE releases SET storage = $2, cid = $3, updated_at = now() WHERE id = $1", [id, JSON.stringify(pub), pub.cid]);
    await audit(ctx.db, user.id, r.project_id, "release.ipfs", id, { cid: pub.cid, provider: pub.provider });
    return releaseDto((await ctx.db.one<ReleaseRow>("SELECT * FROM releases WHERE id = $1", [id]))!);
  });

  /** Queues the pointer in the project's timelock. The key held here can only propose; it cannot touch the address record. */
  app.post("/v1/releases/:id/queue", async (req) => {
    const user = requireUser(req.user);
    const { id } = parse(IdParams, req.params, "release params");
    const r = await loadRelease(user, id, "maintainer");
    if (!ctx.cfg.PROPOSER_PRIVATE_KEY) throw notConfigured("PROPOSER_NOT_CONFIGURED", "set PROPOSER_PRIVATE_KEY (a testnet key holding only the proposer role)");
    if (r.signature_status !== "verified") throw conflict("only a release with a verified signature can be queued", "NOT_SIGNED");
    if (r.status !== "signed") throw conflict(`release is ${r.status}, not signed`, "BAD_STATE");
    const { chain, timelock } = await chainFor(r);
    const q = await queuePointer(chain, signerFromKey(chain, ctx.cfg.PROPOSER_PRIVATE_KEY, "PROPOSER_PRIVATE_KEY"), timelock, r.pointer);
    await ctx.db.query("UPDATE releases SET status = 'queued', timelock_op_id = $2, queue_tx = $3, eta = to_timestamp($4), updated_at = now() WHERE id = $1", [id, q.id.toString(), q.txHash, Number(q.eta)]);
    await audit(ctx.db, user.id, r.project_id, "release.queue", id, { op: q.id.toString(), tx: q.txHash });
    return releaseDto((await ctx.db.one<ReleaseRow>("SELECT * FROM releases WHERE id = $1", [id]))!);
  });

  app.post("/v1/releases/:id/execute", async (req) => {
    const user = requireUser(req.user);
    const { id } = parse(IdParams, req.params, "release params");
    const r = await loadRelease(user, id, "maintainer");
    if (!ctx.cfg.PROPOSER_PRIVATE_KEY) throw notConfigured("PROPOSER_NOT_CONFIGURED", "set PROPOSER_PRIVATE_KEY on the server");
    if (r.status !== "queued" || !r.timelock_op_id) throw conflict("release is not queued", "BAD_STATE");
    if (r.eta && new Date(r.eta).getTime() > ctx.deps.now().getTime()) throw conflict(`the timelock delay ends at ${new Date(r.eta).toISOString()}`, "TIMELOCK_PENDING");
    const { chain, timelock } = await chainFor(r);
    const tx = await executeOp(chain, signerFromKey(chain, ctx.cfg.PROPOSER_PRIVATE_KEY, "PROPOSER_PRIVATE_KEY"), timelock, BigInt(r.timelock_op_id));
    await ctx.db.tx(async (t) => {
      await t.query("UPDATE releases SET status = 'superseded', updated_at = now() WHERE project_id = $1 AND status = 'active'", [r.project_id]);
      await t.query("UPDATE releases SET status = 'active', execute_tx = $2, updated_at = now() WHERE id = $1", [id, tx]);
    });
    await audit(ctx.db, user.id, r.project_id, "release.execute", id, { tx });
    return releaseDto((await ctx.db.one<ReleaseRow>("SELECT * FROM releases WHERE id = $1", [id]))!);
  });

  /** Re-reads the timelock operation from the chain: executed elsewhere, cancelled by the guardian, or still pending. */
  app.post("/v1/releases/:id/refresh", async (req) => {
    const user = requireUser(req.user);
    const { id } = parse(IdParams, req.params, "release params");
    const r = await loadRelease(user, id, "maintainer");
    if (!r.timelock_op_id) throw conflict("release has not been queued", "BAD_STATE");
    const { chain, timelock } = await chainFor(r);
    const [value, eta, stateIdx] = await chain.pub.readContract({ address: timelock, abi: timelockAbi, functionName: "getOperation", args: [BigInt(r.timelock_op_id)] });
    const state = TIMELOCK_STATE[stateIdx] ?? "None";
    if (value !== r.pointer) throw conflict("the on-chain operation holds a different pointer than this release", "POINTER_MISMATCH");
    const next = state === "Executed" ? "active" : state === "Cancelled" ? "cancelled" : r.status;
    if (next === "active" && r.status !== "active") {
      await ctx.db.tx(async (t) => {
        await t.query("UPDATE releases SET status = 'superseded', updated_at = now() WHERE project_id = $1 AND status = 'active' AND id <> $2", [r.project_id, id]);
        await t.query("UPDATE releases SET status = 'active', eta = to_timestamp($2), refreshed_at = now(), updated_at = now() WHERE id = $1", [id, Number(eta)]);
      });
    } else {
      await ctx.db.query("UPDATE releases SET status = $2, eta = to_timestamp($3), refreshed_at = now(), updated_at = now() WHERE id = $1", [id, next, Number(eta)]);
    }
    return releaseDto((await ctx.db.one<ReleaseRow>("SELECT * FROM releases WHERE id = $1", [id]))!);
  });
}
