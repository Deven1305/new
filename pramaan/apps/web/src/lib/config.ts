function trimUrl(value: string | undefined, fallback: string): string {
  const v = (value ?? "").trim();
  return (v || fallback).replace(/\/+$/, "");
}

/** Pramaan backend base URL. The dashboard needs it; the extension's verification path never does. */
export const API_BASE_URL = trimUrl(import.meta.env.VITE_API_URL, "http://localhost:8787");

/** Gateway for IPFS links when the backend's release record does not name one (matches the backend's default). */
export const IPFS_GATEWAY_URL = trimUrl(import.meta.env.VITE_IPFS_GATEWAY_URL, "http://127.0.0.1:8080");

export interface DemoApp {
  id: "vaultlab" | "mirroryield" | "permitmarket";
  name: string;
  kind: string;
  url: string;
  story: string;
  shows: string[];
}

/** The three independent demo dApps (separate origins, manifests and ENS identities) served locally by the demo stack. */
export const DEMO_APPS: DemoApp[] = [
  {
    id: "vaultlab",
    name: "VaultLab",
    kind: "Vault",
    url: "http://localhost:5180",
    story: "A real exploit reproduced, then a fix verified.",
    shows: ["Slither and Aderyn candidates", "Foundry exploit test passes on the vulnerable vault", "Fix re-proved: the exploit fails and the suite passes"],
  },
  {
    id: "mirroryield",
    name: "MirrorYield",
    kind: "Yield dashboard",
    url: "http://localhost:5182",
    story: "A tampered website is detected before you sign.",
    shows: ["Served files hashed against the signed release", "One changed script turns the verdict red", "Signing is blocked while the site does not match"],
  },
  {
    id: "permitmarket",
    name: "PermitMarket",
    kind: "NFT market",
    url: "http://localhost:5184",
    story: "An unlimited approval and a wallet-address leak.",
    shows: ["Unlimited approval explained in English, Hindi and Marathi", "Third parties that receive your address are observed", "Undeclared trackers are flagged and can be blocked"],
  },
];
