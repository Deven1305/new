import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { safeEqual } from "../auth.js";
import type { Ctx } from "../context.js";
import { badRequest, notConfigured, parse, unauthorized } from "../errors.js";
import { assertSafeHttpUrl } from "../net.js";
import { enqueueJob } from "../queue.js";
import { parseGithubUrl } from "./jobs.js";
import type { ChainConfig } from "@pramaan/verifier-core";

export function registerPublicRoutes(app: FastifyInstance, ctx: Ctx): void {
  /**
   * Public convenience check of a live site (the browser extension does this locally and does not need this server).
   * Chains come from VERIFY_RPC_URLS plus the RPC of imported demo projects; the user supplies only the site URL.
   */
  app.post(
    "/v1/verify/site",
    { config: { rateLimit: { max: ctx.cfg.RATE_LIMIT_PUBLIC_MAX, timeWindow: ctx.cfg.RATE_LIMIT_WINDOW_MS } } },
    async (req) => {
      const { url } = parse(z.object({ url: z.string().trim().min(1).max(500) }), req.body, "verify body");
      const origin = (await assertSafeHttpUrl(url, ctx.cfg.allowPrivateNetwork, "url")).origin;
      const chains: Record<number, ChainConfig> = {};
      for (const [id, urls] of Object.entries(ctx.cfg.verifyRpcUrls)) chains[Number(id)] = { chainId: Number(id), rpcUrls: urls };
      const demo = await ctx.db.query<{ chain_id: number; rpc_url: string }>("SELECT DISTINCT chain_id, rpc_url FROM projects WHERE is_demo = true AND chain_id IS NOT NULL AND rpc_url IS NOT NULL");
      for (const d of demo) if (!chains[d.chain_id]) chains[d.chain_id] = { chainId: d.chain_id, rpcUrls: [d.rpc_url] };
      if (Object.keys(chains).length === 0) throw notConfigured("NO_CHAINS", "no RPC is configured for verification (set VERIFY_RPC_URLS)");
      return ctx.deps.verifySite({ origin, chains });
    },
  );

  /** GitHub push webhook: queues an analysis of the pushed commit for the project registered with that repository. */
  app.post("/v1/webhooks/github", { bodyLimit: 1024 * 1024 }, async (req, reply) => {
    const secret = ctx.cfg.GITHUB_WEBHOOK_SECRET;
    if (!secret) throw notConfigured("WEBHOOK_NOT_CONFIGURED", "GITHUB_WEBHOOK_SECRET is not set on this server");
    const raw = req.rawBody;
    const header = req.headers["x-hub-signature-256"];
    if (!raw || typeof header !== "string") throw unauthorized("missing signature", "SIGNATURE_MISSING");
    const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
    if (!m || !safeEqual(createHmac("sha256", secret).update(raw).digest("hex"), m[1]!.toLowerCase())) throw unauthorized("invalid signature", "SIGNATURE_INVALID");

    const event = req.headers["x-github-event"];
    if (event === "ping") return { ok: true, event: "ping" };
    if (event !== "push") return reply.code(202).send({ ok: true, ignored: `event ${String(event)}` });
    const body = parse(
      z.object({ after: z.string().regex(/^[0-9a-f]{40}$/), deleted: z.boolean().optional(), repository: z.object({ html_url: z.string().max(300) }) }),
      req.body,
      "push payload",
    );
    if (body.deleted || /^0+$/.test(body.after)) return reply.code(202).send({ ok: true, ignored: "branch deleted" });
    let url: string;
    try {
      url = parseGithubUrl(body.repository.html_url);
    } catch {
      throw badRequest("unsupported repository URL");
    }
    const projects = await ctx.db.query<{ id: string }>("SELECT id FROM projects WHERE lower(regexp_replace(repo_url, '(\.git)?/?$', '')) = lower($1)", [url]);
    if (projects.length === 0) return reply.code(202).send({ ok: true, ignored: "no project registered for this repository" });
    const jobs = [];
    for (const p of projects) {
      // pinned to the pushed commit, so redelivery of the same push is answered with the same job
      const { job, deduplicated } = await enqueueJob(ctx.db, { projectId: p.id, kind: "analyze", source: { type: "github", url, ref: body.after }, params: {}, commit: body.after, createdBy: null });
      jobs.push({ jobId: job.id, projectId: p.id, deduplicated });
    }
    return reply.code(202).send({ ok: true, jobs });
  });
}
