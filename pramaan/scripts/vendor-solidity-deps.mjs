#!/usr/bin/env node
// Vendors pinned Solidity dependencies as plain files (no git submodules, no symlinks), so that a project
// directory can be copied into the network-less analysis sandbox and still compile.
//
//   node scripts/vendor-solidity-deps.mjs <foundry-project-dir> [--with-oz]
//
// npm tarballs are checked against the registry's sha512 integrity; the forge-std GitHub tarball is checked
// against the sha256 pinned below.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync, existsSync, cpSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const OZ_VERSION = "5.6.1";
const FORGE_STD = {
  tag: "v1.16.2",
  commit: "bf647bd6046f2f7da30d0c2bf435e5c76a780c1b",
  // sha256 of https://codeload.github.com/foundry-rs/forge-std/tar.gz/<commit>
  sha256: "bcea26d86e1f5955c5914959bf34ae6f4c5897fbc9b390ff4b25232cadb859a2",
};

const args = process.argv.slice(2);
const projectDir = resolve(args.find((a) => !a.startsWith("--")) ?? "contracts");
const withOz = args.includes("--with-oz");
const libDir = join(projectDir, "lib");
const work = join(tmpdir(), `pramaan-vendor-${process.pid}`);
mkdirSync(work, { recursive: true });

async function download(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function extract(tgz, dest) {
  mkdirSync(dest, { recursive: true });
  const file = join(work, `t-${Math.random().toString(36).slice(2)}.tgz`);
  writeFileSync(file, tgz);
  execFileSync("tar", ["-xzf", file, "-C", dest], { stdio: "inherit" });
}

async function vendorNpm(pkg, target) {
  const meta = await (await fetch(`https://registry.npmjs.org/${pkg}/${OZ_VERSION}`)).json();
  const integrity = meta.dist?.integrity;
  if (!integrity?.startsWith("sha512-")) throw new Error(`no sha512 integrity for ${pkg}`);
  const tgz = await download(meta.dist.tarball);
  const actual = "sha512-" + createHash("sha512").update(tgz).digest("base64");
  if (actual !== integrity) throw new Error(`integrity mismatch for ${pkg}: ${actual} != ${integrity}`);
  const tmp = join(work, pkg.replace(/[@/]/g, "_"));
  extract(tgz, tmp);
  rmSync(target, { recursive: true, force: true });
  cpSync(join(tmp, "package"), target, { recursive: true });
  console.log(`vendored ${pkg}@${OZ_VERSION} -> ${target} (${integrity.slice(0, 22)}…)`);
}

async function vendorForgeStd(target) {
  const url = `https://codeload.github.com/foundry-rs/forge-std/tar.gz/${FORGE_STD.commit}`;
  const tgz = await download(url);
  const actual = createHash("sha256").update(tgz).digest("hex");
  if (FORGE_STD.sha256 && actual !== FORGE_STD.sha256) {
    throw new Error(`forge-std sha256 mismatch: ${actual} != ${FORGE_STD.sha256}`);
  }
  const tmp = join(work, "forge-std");
  extract(tgz, tmp);
  const root = readdirSync(tmp).find((d) => d.startsWith("forge-std-"));
  if (!root) throw new Error("unexpected forge-std tarball layout");
  rmSync(target, { recursive: true, force: true });
  cpSync(join(tmp, root), target, { recursive: true });
  // Drop upstream CI and test files we do not need inside the analysis sandbox.
  for (const extra of [".github", "test", "scripts"]) rmSync(join(target, extra), { recursive: true, force: true });
  console.log(`vendored forge-std ${FORGE_STD.tag} (${FORGE_STD.commit.slice(0, 10)}, sha256 ${actual}) -> ${target}`);
}

mkdirSync(libDir, { recursive: true });
await vendorForgeStd(join(libDir, "forge-std"));
if (withOz) {
  await vendorNpm("@openzeppelin/contracts", join(libDir, "openzeppelin-contracts"));
  await vendorNpm("@openzeppelin/contracts-upgradeable", join(libDir, "openzeppelin-contracts-upgradeable"));
}
rmSync(work, { recursive: true, force: true });
if (!existsSync(join(libDir, "forge-std", "src", "Test.sol"))) throw new Error("forge-std missing Test.sol");
