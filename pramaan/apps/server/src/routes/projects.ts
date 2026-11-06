import { publicRpcOrigin } from "../net.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  assertRole,
  audit,
  requireAccountLevel,
  requireUser,
  type Role,
} from "../auth.js";
import type { Ctx } from "../context.js";
import { notFound, parse } from "../errors.js";

const CreateProjectSchema = z.object({
  name: z.string().trim().min(1, "Project name is required").max(80, "Name cannot exceed 80 characters"),
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9-]+$/, "Slug must contain only lowercase letters, numbers, and hyphens").optional(),
  ensName: z.string().trim().max(255).optional().nullable(),
  domain: z.string().trim().max(255).optional().nullable(),
  repoUrl: z.string().trim().url("Invalid repository URL").max(500).optional().nullable(),
  chainId: z.number().int().positive("Chain ID must be positive").optional().nullable(),
  rpcUrl: z.string().trim().url("Invalid RPC URL").max(500).optional().nullable(),
});

const PatchProjectSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  ensName: z.string().trim().max(255).optional().nullable(),
  domain: z.string().trim().max(255).optional().nullable(),
  repoUrl: z.string().trim().url().max(500).optional().nullable(),
  chainId: z.number().int().positive().optional().nullable(),
  rpcUrl: z.string().trim().url().max(500).optional().nullable(),
  resolverAddress: z.string().trim().max(255).optional().nullable(),
  timelockAddress: z.string().trim().max(255).optional().nullable(),
});

const ProjectParamsSchema = z.object({
  id: z.string().uuid("Invalid project ID"),
});

interface ProjectDbRow {
  id: string;
  name: string;
  slug: string;
  ens_name: string | null;
  domain: string | null;
  repo_url: string | null;
  chain_id: number | null;
  rpc_url: string | null;
  resolver_address: string | null;
  timelock_address: string | null;
  is_demo: boolean;
  created_at: Date;
  updated_at: Date;
  member_role?: string | null;
}

interface ActiveReleaseDbRow {
  id: string;
  project_id: string;
  tag: string;
  manifest_sha256: string;
  status: string;
}

interface MemberDbRow {
  id: string;
  address: string | null;
  display_name: string | null;
  role: string;
}

interface ContractDbRow {
  id: string;
  role: string;
  chain_id: number;
  address: string;
}

interface MonitorDbRow {
  id: string;
  project_id: string;
  kind: string;
  chain_id: number;
  address: string;
  rpc_url: string | null;
  label: string;
  status: string;
  last_block: number | string | null;
  last_checked_at: Date | null;
  last_error: string | null;
  created_at: Date;
}

interface CountRow {
  count: number | string;
}

interface GroupCountRow {
  project_id: string;
  count: number | string;
}

async function getProjectDetail(ctx: Ctx, projectId: string, userRole: Role) {
  const p = await ctx.db.one<ProjectDbRow>("SELECT * FROM projects WHERE id = $1", [projectId]);
  if (!p) throw notFound("project");

  const activeRelease = await ctx.db.one<ActiveReleaseDbRow>(
    `SELECT id, project_id, tag, manifest_sha256, status
     FROM releases
     WHERE project_id = $1 AND status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`,
    [projectId],
  );

  const findingsCount = await ctx.db.one<CountRow>(
    "SELECT COUNT(*)::int AS count FROM findings WHERE project_id = $1",
    [projectId],
  );
  const alertsCount = await ctx.db.one<CountRow>(
    "SELECT COUNT(*)::int AS count FROM alerts WHERE project_id = $1 AND status = 'open'",
    [projectId],
  );

  const memberRows = await ctx.db.query<MemberDbRow>(
    `SELECT u.id, u.address, u.display_name, pm.role
     FROM project_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = $1
     ORDER BY pm.created_at ASC`,
    [projectId],
  );

  const contractRows = await ctx.db.query<ContractDbRow>(
    `SELECT id, role, chain_id, address
     FROM project_contracts
     WHERE project_id = $1
     ORDER BY chain_id, address`,
    [projectId],
  );

  const monitorRows = await ctx.db.query<MonitorDbRow>(
    `SELECT id, project_id, kind, chain_id, address, rpc_url, label, status, last_block, last_checked_at, last_error, created_at
     FROM monitors
     WHERE project_id = $1
     ORDER BY created_at ASC`,
    [projectId],
  );

  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    ensName: p.ens_name,
    domain: p.domain,
    repoUrl: p.repo_url,
    chainId: p.chain_id,
    rpcUrl: p.rpc_url,
    resolverAddress: p.resolver_address,
    timelockAddress: p.timelock_address,
    isDemo: p.is_demo,
    role: userRole,
    activeRelease: activeRelease
      ? {
          id: activeRelease.id,
          tag: activeRelease.tag,
          sha256: activeRelease.manifest_sha256,
          status: activeRelease.status,
        }
      : null,
    counts: {
      findings: Number(findingsCount?.count ?? 0),
      openAlerts: Number(alertsCount?.count ?? 0),
    },
    createdAt: new Date(p.created_at).toISOString(),
    members: memberRows.map((m) => ({
      userId: m.id,
      id: m.id,
      address: m.address,
      displayName: m.display_name,
      role: m.role,
    })),
    contracts: contractRows.map((c) => ({
      id: c.id,
      label: c.role,
      chainId: c.chain_id,
      address: c.address,
    })),
    monitors: monitorRows.map((m) => ({
      id: m.id,
      projectId: m.project_id,
      kind: m.kind,
      chainId: m.chain_id,
      address: m.address,
      rpcUrl: publicRpcOrigin(m.rpc_url),
      label: m.label,
      status: m.status,
      lastBlock: m.last_block !== null ? Number(m.last_block) : null,
      lastCheckedAt: m.last_checked_at ? new Date(m.last_checked_at).toISOString() : null,
      lastError: m.last_error ?? null,
      createdAt: new Date(m.created_at).toISOString(),
    })),
  };
}

export function registerProjectRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get("/v1/projects", async (req) => {
    const user = requireUser(req.user);

    const rows = await ctx.db.query<ProjectDbRow>(
      `SELECT
        p.id, p.name, p.slug, p.ens_name, p.domain, p.repo_url, p.chain_id, p.rpc_url,
        p.resolver_address, p.timelock_address, p.is_demo, p.created_at, p.updated_at,
        pm.role AS member_role
       FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
       WHERE ($3::uuid IS NULL OR p.id = $3::uuid)
         AND ($2::boolean = true OR pm.role IS NOT NULL OR p.is_demo = true)
       ORDER BY p.created_at DESC`,
      [user.id, user.isAdmin, user.tokenProjectId],
    );

    const activeReleases = await ctx.db.query<ActiveReleaseDbRow>(
      `SELECT id, project_id, tag, manifest_sha256, status
       FROM releases
       WHERE status = 'active'
       ORDER BY created_at DESC`,
    );
    const activeReleaseByProject = new Map<string, ActiveReleaseDbRow>();
    for (const r of activeReleases) {
      if (!activeReleaseByProject.has(r.project_id)) {
        activeReleaseByProject.set(r.project_id, r);
      }
    }

    const findingCounts = await ctx.db.query<GroupCountRow>(
      "SELECT project_id, COUNT(*)::int AS count FROM findings GROUP BY project_id",
    );
    const findingsByProject = new Map<string, number>();
    for (const f of findingCounts) {
      findingsByProject.set(f.project_id, Number(f.count));
    }

    const alertCounts = await ctx.db.query<GroupCountRow>(
      "SELECT project_id, COUNT(*)::int AS count FROM alerts WHERE status = 'open' GROUP BY project_id",
    );
    const alertsByProject = new Map<string, number>();
    for (const a of alertCounts) {
      alertsByProject.set(a.project_id, Number(a.count));
    }

    return rows.map((p) => {
      let role: Role | null = null;
      if (user.isAdmin) role = "owner";
      else if (p.member_role) role = p.member_role as Role;
      else if (p.is_demo) role = "viewer";

      const ar = activeReleaseByProject.get(p.id);

      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        ensName: p.ens_name,
        domain: p.domain,
        repoUrl: p.repo_url,
        chainId: p.chain_id,
        rpcUrl: p.rpc_url,
        resolverAddress: p.resolver_address,
        timelockAddress: p.timelock_address,
        isDemo: p.is_demo,
        role,
        activeRelease: ar
          ? {
              id: ar.id,
              tag: ar.tag,
              sha256: ar.manifest_sha256,
              status: ar.status,
            }
          : null,
        counts: {
          findings: findingsByProject.get(p.id) ?? 0,
          openAlerts: alertsByProject.get(p.id) ?? 0,
        },
        createdAt: new Date(p.created_at).toISOString(),
      };
    });
  });

  app.post("/v1/projects", async (req, reply) => {
    const user = requireAccountLevel(req.user);
    const body = parse(CreateProjectSchema, req.body, "project create body");

    let baseSlug =
      body.slug ??
      body.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    if (!baseSlug) baseSlug = "project";

    let slug = baseSlug;
    let suffix = 1;
    while (await ctx.db.one("SELECT 1 FROM projects WHERE slug = $1", [slug])) {
      slug = `${baseSlug}-${suffix++}`;
    }

    const now = ctx.deps.now();
    const project = await ctx.db.tx(async (tx) => {
      const p = await tx.one<ProjectDbRow>(
        `INSERT INTO projects (
          slug, name, ens_name, domain, repo_url, chain_id, rpc_url, created_by, is_demo, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9, $9)
         RETURNING *`,
        [
          slug,
          body.name,
          body.ensName ?? null,
          body.domain ?? null,
          body.repoUrl ?? null,
          body.chainId ?? null,
          body.rpcUrl ?? null,
          user.id,
          now,
        ],
      );

      if (!p) throw new Error("failed to insert project");

      await tx.query(
        "INSERT INTO project_members (project_id, user_id, role, created_at) VALUES ($1, $2, 'owner', $3)",
        [p.id, user.id, now],
      );

      await audit(tx, user.id, p.id, "project.create", p.name, { slug: p.slug });

      return p;
    });

    return reply.code(201).send({
      id: project.id,
      name: project.name,
      slug: project.slug,
      ensName: project.ens_name,
      domain: project.domain,
      repoUrl: project.repo_url,
      chainId: project.chain_id,
      rpcUrl: project.rpc_url,
      resolverAddress: project.resolver_address,
      timelockAddress: project.timelock_address,
      isDemo: project.is_demo,
      role: "owner" as Role,
      activeRelease: null,
      counts: {
        findings: 0,
        openAlerts: 0,
      },
      createdAt: new Date(project.created_at).toISOString(),
    });
  });

  app.get("/v1/projects/:id", async (req) => {
    const user = requireUser(req.user);
    const params = parse(ProjectParamsSchema, req.params, "project params");
    const role = await assertRole(ctx.db, user, params.id, "viewer");
    return getProjectDetail(ctx, params.id, role);
  });

  app.patch("/v1/projects/:id", async (req) => {
    const user = requireUser(req.user);
    const params = parse(ProjectParamsSchema, req.params, "project params");
    const role = await assertRole(ctx.db, user, params.id, "maintainer");
    const body = parse(PatchProjectSchema, req.body, "project patch body");

    const updates: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (body.name !== undefined) {
      updates.push(`name = $${i++}`);
      values.push(body.name);
    }
    if (body.ensName !== undefined) {
      updates.push(`ens_name = $${i++}`);
      values.push(body.ensName);
    }
    if (body.domain !== undefined) {
      updates.push(`domain = $${i++}`);
      values.push(body.domain);
    }
    if (body.repoUrl !== undefined) {
      updates.push(`repo_url = $${i++}`);
      values.push(body.repoUrl);
    }
    if (body.chainId !== undefined) {
      updates.push(`chain_id = $${i++}`);
      values.push(body.chainId);
    }
    if (body.rpcUrl !== undefined) {
      updates.push(`rpc_url = $${i++}`);
      values.push(body.rpcUrl);
    }
    if (body.resolverAddress !== undefined) {
      updates.push(`resolver_address = $${i++}`);
      values.push(body.resolverAddress);
    }
    if (body.timelockAddress !== undefined) {
      updates.push(`timelock_address = $${i++}`);
      values.push(body.timelockAddress);
    }

    if (updates.length > 0) {
      updates.push(`updated_at = $${i++}`);
      values.push(ctx.deps.now());
      values.push(params.id);
      await ctx.db.query(
        `UPDATE projects SET ${updates.join(", ")} WHERE id = $${i}`,
        values,
      );
    }

    await audit(ctx.db, user.id, params.id, "project.update", body.name ?? params.id, body);

    return getProjectDetail(ctx, params.id, role);
  });
}
