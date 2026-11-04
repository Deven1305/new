import type { FileEntry, ManifestV1 } from "@pramaan/manifest";

export type ResourceType = "main_frame" | "sub_frame" | "script" | "stylesheet" | "inline_script" | "other";

export interface ObservedResource {
  url: string;
  type: ResourceType;
  /** sha256 hex supplied by the observer; extension observers re-fetch and cannot prove these are the executed bytes. Null while pending. */
  sha256: string | null;
}

export type ResourceStatus =
  | "match"
  | "mismatch"
  | "unlisted"
  | "third-party-declared"
  | "third-party-undeclared"
  | "dynamic-inline"
  | "pending"
  | "ignored";

export interface ResourceCheck {
  url: string;
  type: ResourceType;
  path: string | null;
  status: ResourceStatus;
  expected: string | null;
  actual: string | null;
}

export interface SiteCheck {
  status: "verified" | "mismatch" | "unlisted-script" | "incomplete";
  severity: "green" | "amber" | "red";
  resources: ResourceCheck[];
  summary: string;
}

/** Maps a same-origin URL to the manifest path ("/" → "/index.html", "/docs/" → "/docs/index.html"). */
export function sitePath(url: string, origin: string): string | null {
  try {
    const u = new URL(url);
    if (u.origin.toLowerCase() !== origin.toLowerCase()) return null;
    let path = decodeURIComponent(u.pathname);
    if (path.endsWith("/")) path += "index.html";
    return path;
  } catch {
    return null;
  }
}

export function findFile(manifest: ManifestV1, path: string, navigation: boolean): FileEntry | undefined {
  const direct = manifest.files.find((f) => f.path === path);
  if (direct) return direct;
  if (navigation && manifest.app.spaFallback && !/\.[a-z0-9]{1,8}$/i.test(path)) {
    return manifest.files.find((f) => f.path === manifest.app.spaFallback);
  }
  return undefined;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Compares observed resource hashes with the release. The observer determines how those bytes were obtained. Any same-origin document or script that is missing from
 * the manifest or hashes differently is RED, and so is an undeclared third-party script: either one could be the
 * Bybit-style swap. Stylesheets and dynamically injected inline scripts are AMBER.
 */
export function checkSite(manifest: ManifestV1, origin: string, observed: ObservedResource[]): SiteCheck {
  const resources: ResourceCheck[] = [];
  for (const r of observed) {
    if (/^(chrome|moz|safari-web)-extension:|^about:|^data:|^blob:/.test(r.url)) {
      resources.push({ url: r.url, type: r.type, path: null, status: "ignored", expected: null, actual: r.sha256 });
      continue;
    }
    if (r.type === "inline_script") {
      resources.push({ url: r.url, type: r.type, path: null, status: "dynamic-inline", expected: null, actual: r.sha256 });
      continue;
    }
    const path = sitePath(r.url, origin);
    if (path === null) {
      const host = hostOf(r.url);
      const declared = !!host && manifest.thirdParties.some((t) => t.host === host);
      const relevant = r.type === "script" || r.type === "sub_frame";
      resources.push({
        url: r.url,
        type: r.type,
        path: null,
        status: relevant ? (declared ? "third-party-declared" : "third-party-undeclared") : "ignored",
        expected: null,
        actual: r.sha256,
      });
      continue;
    }
    const file = findFile(manifest, path, r.type === "main_frame" || r.type === "sub_frame");
    if (!file) {
      resources.push({ url: r.url, type: r.type, path, status: r.type === "other" ? "ignored" : "unlisted", expected: null, actual: r.sha256 });
      continue;
    }
    if (r.sha256 === null) {
      resources.push({ url: r.url, type: r.type, path, status: "pending", expected: file.sha256, actual: null });
      continue;
    }
    resources.push({ url: r.url, type: r.type, path, status: r.sha256 === file.sha256 ? "match" : "mismatch", expected: file.sha256, actual: r.sha256 });
  }

  const critical = (c: ResourceCheck) => c.type === "main_frame" || c.type === "sub_frame" || c.type === "script";
  const mismatch = resources.find((c) => c.status === "mismatch" && c.type !== "stylesheet");
  const unlistedScript = resources.find((c) => (c.status === "unlisted" && critical(c)) || c.status === "third-party-undeclared");
  const softIssues = resources.filter(
    (c) => c.status === "dynamic-inline" || c.status === "third-party-declared" || (c.type === "stylesheet" && (c.status === "mismatch" || c.status === "unlisted")),
  );
  const pending = resources.some((c) => c.status === "pending");
  const hasDocument = resources.some((c) => c.type === "main_frame" && c.status === "match");

  if (mismatch) return { status: "mismatch", severity: "red", resources, summary: `${mismatch.path ?? mismatch.url} does not match the release` };
  if (unlistedScript) return { status: "unlisted-script", severity: "red", resources, summary: `${unlistedScript.url} is not in the release` };
  if (pending || !hasDocument) return { status: "incomplete", severity: "amber", resources, summary: "not every loaded file has been checked yet" };
  if (softIssues.length > 0) return { status: "verified", severity: "amber", resources, summary: `${softIssues.length} resource(s) need attention` };
  return { status: "verified", severity: "green", resources, summary: `${resources.filter((c) => c.status === "match").length} files match the release` };
}
