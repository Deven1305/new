import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, "config.local.json");

if (!existsSync(configPath)) {
  console.error(`Config file not found: ${configPath}`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(configPath, "utf8"));
const farmAddress = config.contracts?.farm;

if (!farmAddress) {
  console.error("Missing contracts.farm in test/config.local.json");
  process.exit(1);
}

const distAssetsDir = join(__dirname, "../dist-local/assets");
if (!existsSync(distAssetsDir)) {
  console.error(`Assets directory not found: ${distAssetsDir}`);
  process.exit(1);
}

const jsFiles = readdirSync(distAssetsDir).filter((f) => f.endsWith(".js"));
if (jsFiles.length === 0) {
  console.error(`No .js files found in ${distAssetsDir}`);
  process.exit(1);
}

let totalCount = 0;
const matchingFiles = [];

for (const file of jsFiles) {
  const filePath = join(distAssetsDir, file);
  const content = readFileSync(filePath, "utf8");
  // Case-insensitive boundary match for the address
  const regex = new RegExp(farmAddress, "gi");
  const count = (content.match(regex) || []).length;
  if (count > 0) {
    matchingFiles.push({ file, count });
    totalCount += count;
  }
}

console.log(`[literal-check] Target Farm Address: ${farmAddress}`);
for (const match of matchingFiles) {
  console.log(`[literal-check] File: ${match.file} -> ${match.count} occurrence(s)`);
}
console.log(`[literal-check] Total count: ${totalCount} across ${matchingFiles.length} file(s)`);

if (totalCount < 1) {
  console.error("[literal-check] FAIL: Farm address did not appear in any JavaScript bundle.");
  process.exit(1);
}

if (matchingFiles.length > 1) {
  console.error(
    `[literal-check] FAIL: Farm address appeared across ${matchingFiles.length} files. Must appear in exactly ONE bundle file.`
  );
  process.exit(1);
}

console.log("[literal-check] PASS: Farm address appears in exactly one bundle asset.");
process.exit(0);
