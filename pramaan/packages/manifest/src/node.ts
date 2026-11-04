import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { sha256Hex, sriSha384 } from "./hash.js";
import { ManifestV1, MANIFEST_SCHEMA_V1, WELL_KNOWN_PATH } from "./schema.js";
import type { ContractEntry, DescriptorEntry, FileEntry, FindingEntry, ThirdPartyEntry } from "./schema.js";

export * from "./index.js";

/** Files the site serves that must never be listed in the manifest itself (they describe or sign it). */
export const MANIFEST_SIDECAR_PATHS = new Set([
  "/.well-known/pramaan-manifest.json",
  "/.well-known/pramaan-manifest.sigstore.json",
  "/.well-known/pramaan-manifest.dsse.json",
]);

export interface HashDirectoryOptions {
  maxFiles?: number;
  maxTotalBytes?: number;
  exclude?: (sitePath: string) => boolean;
}

/** Hashes every regular file under `dir` into manifest `files[]` entries, sorted by path. Symlinks are refused. */
export function hashDirectory(dir: string, options: HashDirectoryOptions = {}): FileEntry[] {
  const maxFiles = options.maxFiles ?? 5000;
  const maxTotal = options.maxTotalBytes ?? 200 * 1024 * 1024;
  const out: FileEntry[] = [];
  let total = 0;
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      const st = lstatSync(full);
      if (st.isSymbolicLink()) throw new Error(`refusing to hash symlink ${full}`);
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!st.isFile()) continue;
      const sitePath = "/" + relative(dir, full).split(sep).join("/");
      if (MANIFEST_SIDECAR_PATHS.has(sitePath) || options.exclude?.(sitePath)) continue;
      total += st.size;
      if (out.length >= maxFiles) throw new Error(`more than ${maxFiles} files under ${dir}`);
      if (total > maxTotal) throw new Error(`site build under ${dir} exceeds ${maxTotal} bytes`);
      const data = readFileSync(full);
      out.push({ path: sitePath, sha256: sha256Hex(data), sri: sriSha384(data), size: st.size });
    }
  };
  walk(dir);
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export interface ManifestInput {
  app: { name: string; ensName: string; domain: string; spaFallback?: string };
  repo: string;
  commit: string;
  tag: string;
  workflow: string | null;
  builtAt?: string;
  files: FileEntry[];
  contracts?: ContractEntry[];
  findings?: FindingEntry[];
  descriptors?: DescriptorEntry[];
  thirdParties?: ThirdPartyEntry[];
  tools?: { name: string; version: string }[];
}

const byKey = <T>(key: (t: T) => string) => (a: T, b: T) => {
  const ka = key(a);
  const kb = key(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
};

/** Builds a schema-valid manifest with deterministically ordered arrays. */
export function buildManifest(input: ManifestInput): ManifestV1 {
  const builtAt = input.builtAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return ManifestV1.parse({
    schema: MANIFEST_SCHEMA_V1,
    app: input.app,
    repo: input.repo,
    commit: input.commit,
    tag: input.tag,
    workflow: input.workflow,
    builtAt,
    files: [...input.files].sort(byKey((f) => f.path)),
    contracts: [...(input.contracts ?? [])].sort(byKey((c) => `${c.chainId}:${c.address.toLowerCase()}`)),
    findings: [...(input.findings ?? [])].sort(byKey((f) => f.id)),
    descriptors: [...(input.descriptors ?? [])].sort(byKey((d) => `${d.chainId}:${d.address.toLowerCase()}`)),
    thirdParties: [...(input.thirdParties ?? [])].sort(byKey((t) => t.host)),
    tools: [...(input.tools ?? [])].sort(byKey((t) => t.name)),
  });
}

export { WELL_KNOWN_PATH };
