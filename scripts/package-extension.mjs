// Builds the single HexFence extension (Pramaan engine + HexFence recipient check) and zips it.
//   pnpm extension:package     ->  release/hexfence-extension-<version>.zip  (+ the unpacked folder to Load unpacked)
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const ext = join(root, "pramaan", "apps", "extension");
const win = process.platform === "win32";
const build = spawnSync("pnpm", ["build"], { cwd: ext, stdio: "inherit", shell: win });
if (build.status !== 0) process.exit(build.status ?? 1);
const dist = join(ext, "dist");
if (!existsSync(join(dist, "manifest.json"))) { console.error("build produced no manifest.json"); process.exit(1); }
const version = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8")).version;
const outDir = join(root, "release");
mkdirSync(outDir, { recursive: true });
const zip = join(outDir, `hexfence-extension-${version}.zip`);
rmSync(zip, { force: true });
// Windows 10+: the system bsdtar writes zip (Git Bash's GNU tar cannot). macOS / Linux: the standard `zip` tool.
const z = win
  ? spawnSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-a", "-c", "-f", zip, "-C", dist, "."], { stdio: "inherit" })
  : spawnSync("zip", ["-qr", zip, "."], { cwd: dist, stdio: "inherit" });
if (z.status !== 0) { console.error("could not create the zip; zip the folder by hand: " + dist); process.exit(z.status ?? 1); }
console.log(`\nExtension folder (Load unpacked): ${dist}\nZip: ${zip} (${(statSync(zip).size / 1024).toFixed(0)} KiB)`);
