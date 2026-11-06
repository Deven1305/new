import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = resolve(join(fileURLToPath(new URL(".", import.meta.url)), "../dist-local"));

if (!existsSync(distDir)) {
  console.error(`dist-local does not exist at ${distDir}`);
  process.exit(1);
}

const FORBIDDEN = ["5190", "9132", "/collect", "sendBeacon", "leak"];
let foundViolations = false;

function scan(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      scan(full);
    } else {
      const content = readFileSync(full, "utf-8");
      for (const pattern of FORBIDDEN) {
        if (content.includes(pattern)) {
          console.error(`VIOLATION: file ${full} contains forbidden pattern "${pattern}"`);
          foundViolations = true;
        }
      }
    }
  }
}

scan(distDir);

if (foundViolations) {
  console.error("Tracker leakage detected in production build!");
  process.exit(1);
} else {
  console.log("production build clean");
  process.exit(0);
}

