// Static hosts for the three demo dApps (local demo only; every listener binds 127.0.0.1).
//
//   node server/serve.mjs [--state <DemoStateV2 json>] [--fixtures] [--out <dir>] [--ports vaultlab=5180,mirroryield=5182,...]
//
//   VaultLab     :5180   apps/demos/dist/vaultlab
//   MirrorYield  :5182   apps/demos/dist/mirroryield          (tamper / restore patch these files on disk)
//   lookalike    :5183   the SAME mirroryield files on an origin the ENS record does not claim
//   PermitMarket :5184   apps/demos/dist/permitmarket; the attack fixture is served at /__fixtures/leak.html ONLY with --fixtures
//   admin        :5189   POST /tamper?app=mirroryield  POST /restore?app=mirroryield  GET /status   (rejects browser-origin requests)
//   tracker      :5190   only with --fixtures: logs every request (GET/POST/beacon/pixel) at /collect; GET /log shows them
//
// Release sidecars (/.well-known/pramaan-manifest.json and .dsse.json) are served from the files the demo state points
// at (apps.<id>.release.manifestPath / signaturePath), exactly like the original single-app demo host did.
// Everything is served with `no-store`: a tampered file must show up on the next reload, never from a cache.
import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_IDS, defaultStatePath, loadState, outputDirs, repoPath } from "../scripts/common.mjs";
import { backupDirFor, restore, status, tamper } from "../scripts/tamper.mjs";

export const DEFAULT_PORTS = { vaultlab: 5180, mirroryield: 5182, lookalike: 5183, permitmarket: 5184, admin: 5189, tracker: 5190 };
const HOST = "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};
const SIDECARS = {
  "/.well-known/pramaan-manifest.json": "manifestPath",
  "/.well-known/pramaan-manifest.dsse.json": "signaturePath",
};
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64");

/** Maps a URL path to a file under `root`, or null if it is malformed, escapes the root, or is not a regular file. */
export function resolveStaticFile(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const rootAbs = resolve(root);
  let candidate = resolve(rootAbs, "." + (decoded.startsWith("/") ? decoded : `/${decoded}`));
  if (candidate !== rootAbs && !candidate.startsWith(rootAbs + sep)) return null;
  if (!existsSync(candidate)) return null;
  if (statSync(candidate).isDirectory()) candidate = join(candidate, "index.html");
  if (!existsSync(candidate) || !statSync(candidate).isFile()) return null;
  // symlinks must not lead out of the root either
  const real = realpathSync(candidate);
  const realRoot = realpathSync(rootAbs);
  if (real !== realRoot && !real.startsWith(realRoot + sep)) return null;
  return candidate;
}

function sendFile(req, res, file, extraHeaders = {}) {
  const size = statSync(file).size;
  res.writeHead(200, {
    "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
    "content-length": size,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  if (req.method === "HEAD") return void res.end();
  createReadStream(file).pipe(res);
}

function plain(res, status_, text, headers = {}) {
  res.writeHead(status_, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers });
  res.end(text);
}

function json(res, status_, value, headers = {}) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status_, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers });
  res.end(body);
}

function siteHandler({ root, release, fixturesRoot }) {
  return (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") return plain(res, 405, "method not allowed", { allow: "GET, HEAD" });
    let pathname;
    try {
      pathname = new URL(req.url ?? "/", "http://x").pathname;
    } catch {
      return plain(res, 400, "bad request");
    }
    const cors = pathname.startsWith("/.well-known/") ? { "access-control-allow-origin": "*" } : {};
    const sidecar = SIDECARS[pathname];
    if (sidecar) {
      const file = release?.[sidecar] ? repoPath(release[sidecar]) : null;
      if (!file || !existsSync(file)) return plain(res, 404, "not found", cors);
      return sendFile(req, res, file, { ...cors, "content-type": "application/json; charset=utf-8" });
    }
    if (fixturesRoot && (pathname === "/__fixtures" || pathname.startsWith("/__fixtures/"))) {
      const rel = pathname.slice("/__fixtures".length) || "/";
      const file = resolveStaticFile(fixturesRoot, rel);
      return file ? sendFile(req, res, file) : plain(res, 404, "not found");
    }
    const file = resolveStaticFile(root, pathname);
    return file ? sendFile(req, res, file, cors) : plain(res, 404, "not found", cors);
  };
}

function trackerHandler(log) {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, PUT, OPTIONS" };
  return (req, res) => {
    let url;
    try {
      url = new URL(req.url ?? "/", "http://x");
    } catch {
      return plain(res, 400, "bad request");
    }
    if (url.pathname === "/log" && req.method === "GET") return json(res, 200, log, cors);
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size <= 65_536) chunks.push(c);
    });
    req.on("end", () => {
      if (req.method === "OPTIONS") {
        log.push({ at: new Date().toISOString(), kind: "preflight", method: "OPTIONS", path: url.pathname, query: Object.fromEntries(url.searchParams), headers: pickHeaders(req), body: "" });
        res.writeHead(204, { ...cors, "cache-control": "no-store" }).end();
        return;
      }
      const body = Buffer.concat(chunks);
      log.push({
        at: new Date().toISOString(),
        kind: req.method === "GET" ? ((req.headers["accept"] ?? "").includes("image/") ? "pixel-or-get" : "get") : "post",
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: pickHeaders(req),
        body: body.toString("utf8"),
        bodyBase64: body.length > 0 ? body.toString("base64") : "",
      });
      if (log.length > 1000) log.shift();
      if (req.method === "GET" || req.method === "HEAD") {
        res.writeHead(200, { ...cors, "content-type": "image/gif", "content-length": PIXEL.length, "cache-control": "no-store" });
        return void res.end(req.method === "HEAD" ? undefined : PIXEL);
      }
      res.writeHead(204, { ...cors, "cache-control": "no-store" }).end();
    });
  };
}

function pickHeaders(req) {
  const h = req.headers;
  return { origin: h["origin"] ?? null, referer: h["referer"] ?? null, "content-type": h["content-type"] ?? null, "user-agent": h["user-agent"] ?? null, accept: h["accept"] ?? null };
}

function adminHandler(state, dirs) {
  const app = "mirroryield";
  const farm = state.apps[app].contracts["farm"];
  const attacker = state.apps[app].unlisted?.["attacker"];
  const backupDir = backupDirFor(dirs[app].dist);
  return (req, res) => {
    // A browser page must not be able to flip the demo: refuse anything that carries an Origin header, and require a loopback Host.
    if (req.headers["origin"]) return json(res, 403, { error: "browser-origin requests are refused by the demo admin endpoint" });
    const host = String(req.headers["host"] ?? "").replace(/:\d+$/, "");
    if (host !== "127.0.0.1" && host !== "localhost" && host !== "[::1]") return json(res, 403, { error: "bad Host header" });
    let url;
    try {
      url = new URL(req.url ?? "/", "http://x");
    } catch {
      return json(res, 400, { error: "bad request" });
    }
    const target = url.searchParams.get("app") ?? app;
    if (target !== app) return json(res, 400, { error: `only "${app}" can be tampered with` });
    const current = () => ({ app, ...status({ distDir: dirs[app].dist, backupDir, address: farm }) });
    try {
      if (url.pathname === "/status" && req.method === "GET") return json(res, 200, current());
      if (url.pathname === "/tamper" && req.method === "POST") {
        if (!attacker) return json(res, 500, { error: "demo state has no apps.mirroryield.unlisted.attacker" });
        const r = tamper({ distDir: dirs[app].dist, backupDir, from: farm, to: attacker });
        console.log(`tamper: ${r.replacements} replacement(s) of ${farm} -> ${attacker} in ${r.files.map((f) => f.path).join(", ")}`);
        return json(res, 200, { ok: true, replacements: r.replacements, ...current() });
      }
      if (url.pathname === "/restore" && req.method === "POST") {
        const r = restore({ distDir: dirs[app].dist, backupDir });
        console.log(`restore: original bytes back in ${r.files.map((f) => f.path).join(", ")}`);
        return json(res, 200, { ok: true, ...current() });
      }
      return json(res, url.pathname === "/status" || url.pathname === "/tamper" || url.pathname === "/restore" ? 405 : 404, { error: "use GET /status, POST /tamper?app=mirroryield, POST /restore?app=mirroryield" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json(res, /already tampered|not tampered/.test(message) ? 409 : 500, { error: message });
    }
  };
}

function listen(server, port, label) {
  return new Promise((resolvePromise, reject) => {
    server.once("error", (err) => reject(new Error(`${label}: cannot listen on ${HOST}:${port} (${err.code ?? err.message})`)));
    server.listen(port, HOST, () => resolvePromise());
  });
}

/**
 * Starts every listener. Returns { ports, urls, trackerLog, close() }. Throws (after closing what was opened) if a port is taken.
 */
export async function startDemoServers({ statePath = defaultStatePath(), fixtures = false, out, ports: portOverrides = {}, quiet = false } = {}) {
  const state = loadState(resolve(statePath));
  const ports = { ...DEFAULT_PORTS, ...portOverrides };
  const dirs = Object.fromEntries(APP_IDS.map((id) => [id, outputDirs(state, id, out)]));
  for (const id of APP_IDS) if (!existsSync(dirs[id].dist)) console.warn(`warning: ${dirs[id].dist} is missing (run: pnpm build:demos)`);
  const trackerLog = [];
  const servers = [];
  const urls = {};
  const add = async (label, port, handler, url) => {
    const server = createServer(handler);
    servers.push(server);
    await listen(server, port, label);
    urls[label] = url;
    if (!quiet) console.log(`${label.padEnd(13)} ${url}`);
  };
  try {
    for (const id of APP_IDS) {
      const fixturesRoot = id === "permitmarket" && fixtures ? dirs[id].fixtures : undefined;
      await add(id, ports[id], siteHandler({ root: dirs[id].dist, release: state.apps[id].release, fixturesRoot }), `http://localhost:${ports[id]}`);
      if (id === "mirroryield") await add("lookalike", ports.lookalike, siteHandler({ root: dirs[id].dist, release: state.apps[id].release }), `http://127.0.0.1:${ports.lookalike}`);
    }
    await add("admin", ports.admin, adminHandler(state, dirs), `http://127.0.0.1:${ports.admin}`);
    if (fixtures) await add("tracker", ports.tracker, trackerHandler(trackerLog), `http://127.0.0.1:${ports.tracker}`);
  } catch (err) {
    await Promise.all(servers.map((s) => new Promise((r) => s.close(() => r()))));
    throw err;
  }
  return {
    ports,
    urls,
    trackerLog,
    state,
    close: () => Promise.all(servers.map((s) => new Promise((r) => (s.closeAllConnections?.(), s.close(() => r()))))),
  };
}

function parsePorts(text) {
  const out = {};
  for (const part of text.split(",").filter(Boolean)) {
    const [k, v] = part.split("=");
    const n = Number(v);
    if (!k || !(k in DEFAULT_PORTS) || !Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`bad --ports entry "${part}" (keys: ${Object.keys(DEFAULT_PORTS).join(", ")})`);
    out[k] = n;
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  try {
    const running = await startDemoServers({ statePath: opt("state") ?? defaultStatePath(), fixtures: argv.includes("--fixtures"), out: opt("out"), ports: opt("ports") ? parsePorts(opt("ports")) : {} });
    console.log(`serving. admin: POST ${running.urls["admin"]}/tamper?app=mirroryield  POST /restore?app=mirroryield  GET /status${argv.includes("--fixtures") ? `   tracker log: ${running.urls["tracker"]}/log` : ""}`);
    const stop = () => void running.close().then(() => process.exit(0));
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } catch (err) {
    console.error(`demo:serve failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
