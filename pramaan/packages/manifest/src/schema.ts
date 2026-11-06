import { z } from "zod";

/** Field formats shared by every schema. */
export const hex64 = z.string().regex(/^[0-9a-f]{64}$/, "expected 64 lowercase hex characters");
export const bytes32 = z.string().regex(/^0x[0-9a-f]{64}$/, "expected 0x-prefixed 32-byte lowercase hex");
export const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 20-byte hex address");
export const sri = z.string().regex(/^sha(256|384|512)-[A-Za-z0-9+/]+={0,2}$/, "expected an SRI value");
export const origin = z
  .string()
  .regex(/^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/, "expected an origin such as https://app.example.com (no path, lowercase)");
export const ensName = z
  .string()
  .min(3)
  .max(255)
  .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, "expected a normalized ASCII ENS name such as vault.eth");
const sitePath = z
  .string()
  .max(1024)
  .regex(/^\/[^\s?#]*$/, "file paths start with '/' and carry no query or fragment")
  .refine((p) => !p.split("/").some((seg) => seg === ".." || seg === "."), "file paths must not contain '.' or '..' segments");

export const MANIFEST_SCHEMA_V1 = "https://pramaan.dev/schemas/manifest/v1";
export const EVIDENCE_SCHEMA_V1 = "https://pramaan.dev/schemas/evidence/v1";
export const WELL_KNOWN_PATH = "/.well-known/pramaan.json";

export const proxyTypes = ["eip1967", "eip1967-beacon", "eip1822", "eip1167", "safe", "eip7702"] as const;
export const sourcifyStatuses = ["exact_match", "match", "not_found", "not_checked", "not_applicable"] as const;
export const severities = ["critical", "high", "medium", "low", "info"] as const;
export const findingStatuses = ["reproduced", "fixed-verified", "not-reproduced", "candidate", "accepted-risk"] as const;

export const FileEntry = z.strictObject({
  path: sitePath,
  sha256: hex64,
  sri,
  size: z.number().int().nonnegative().optional(),
});

export const ContractEntry = z.strictObject({
  label: z.string().min(1).max(64),
  chainId: z.number().int().positive(),
  address,
  runtimeCodehash: bytes32,
  proxy: z
    .strictObject({
      type: z.enum(proxyTypes),
      implAddress: address,
      implCodehash: bytes32,
    })
    .nullable(),
  sourcify: z.strictObject({ status: z.enum(sourcifyStatuses) }),
});

export const FindingEntry = z.strictObject({
  id: z.string().regex(/^[A-Z]{2,8}-\d{1,6}$/),
  title: z.string().max(200).optional(),
  class: z.string().min(1).max(64),
  severity: z.enum(severities),
  status: z.enum(findingStatuses),
  exploitTestSha256: hex64.nullable(),
  evidenceSha256: hex64.nullable(),
  fixCommit: z.string().regex(/^[0-9a-f]{7,64}$/).nullable(),
});

export const DescriptorEntry = z.strictObject({
  chainId: z.number().int().positive(),
  address,
  erc7730Sha256: hex64,
  path: sitePath,
});

export const ThirdPartyEntry = z.strictObject({
  host: z.string().regex(/^[a-z0-9.-]+(:\d{1,5})?$/),
  purpose: z.string().min(1).max(200),
  receivesAddress: z.boolean(),
});

export const ToolEntry = z.strictObject({
  name: z.string().min(1).max(64),
  version: z.string().min(1).max(128),
});

export const ManifestV1 = z.strictObject({
  schema: z.literal(MANIFEST_SCHEMA_V1),
  app: z.strictObject({
    name: z.string().min(1).max(100),
    ensName,
    domain: origin,
    spaFallback: sitePath.optional(),
  }),
  repo: z.string().regex(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$|^local:[A-Za-z0-9_.\/-]+$/),
  commit: z.string().regex(/^[0-9a-f]{40}$|^[0-9a-f]{64}$/),
  tag: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/),
  workflow: z.string().max(200).nullable(),
  builtAt: z.iso.datetime({ offset: false }),
  files: z.array(FileEntry).max(5000),
  contracts: z.array(ContractEntry).max(200),
  findings: z.array(FindingEntry).max(500),
  descriptors: z.array(DescriptorEntry).max(200),
  thirdParties: z.array(ThirdPartyEntry).max(100),
  tools: z.array(ToolEntry).max(50),
});
export type ManifestV1 = z.infer<typeof ManifestV1>;
export type ContractEntry = z.infer<typeof ContractEntry>;
export type FileEntry = z.infer<typeof FileEntry>;
export type FindingEntry = z.infer<typeof FindingEntry>;
export type ThirdPartyEntry = z.infer<typeof ThirdPartyEntry>;
export type DescriptorEntry = z.infer<typeof DescriptorEntry>;

/** `/.well-known/pramaan.json`: an untrusted HINT. Every value in it is re-checked against ENS. */
export const WellKnownHint = z.object({
  pramaan: z.literal(1),
  ensName,
  chainId: z.number().int().positive(),
  manifestUrls: z.array(z.url()).max(8).optional(),
  signatureUrls: z.array(z.url()).max(8).optional(),
});
export type WellKnownHint = z.infer<typeof WellKnownHint>;

export const EvidenceV1 = z.strictObject({
  schema: z.literal(EVIDENCE_SCHEMA_V1),
  findingId: z.string(),
  createdAt: z.iso.datetime({ offset: false }),
  target: z.strictObject({
    repo: z.string(),
    commit: z.string().nullable(),
    contract: z.string(),
    function: z.string().nullable(),
    fixedRef: z.string().nullable(),
  }),
  candidateSource: z.strictObject({
    tool: z.string(),
    detector: z.string(),
    location: z.strictObject({ file: z.string(), lines: z.array(z.number().int()), contract: z.string(), function: z.string().nullable() }),
  }),
  template: z.strictObject({ id: z.string(), version: z.string(), filledBy: z.enum(["heuristics", "config", "ai"]) }),
  preconditions: z.array(z.string()),
  property: z.string(),
  testPath: z.string(),
  testSha256: hex64,
  gates: z.array(z.strictObject({ id: z.string(), passed: z.boolean(), detail: z.string() })),
  vulnerableRun: z.strictObject({
    result: z.enum(["passed", "failed", "error", "not-run"]),
    reason: z.string().nullable(),
    traceExcerpt: z.string(),
    durationMs: z.number().nullable(),
  }),
  fixedRun: z.strictObject({
    result: z.enum(["failed-as-expected", "passed-unexpectedly", "error", "not-run"]),
    revertReason: z.string().nullable(),
    ref: z.string().nullable(),
  }),
  regressionSuite: z.strictObject({ passed: z.number().int(), failed: z.number().int(), skipped: z.number().int(), ran: z.boolean() }),
  confidence: z.enum(["reproduced", "not-reproduced"]),
  humanReviewed: z.boolean(),
  tools: z.array(ToolEntry),
});
export type EvidenceV1 = z.infer<typeof EvidenceV1>;

/** Output of contracts/script/Deploy.s.sol (deployments/<chainId>.json). */
const DeploymentEntry = z.object({
  address,
  runtimeCodehash: bytes32,
  proxy: z.enum(["none", "eip1967"]),
  implementation: address.optional(),
  implementationCodehash: bytes32.optional(),
});
export const DeploymentRecord = z.object({
  chainId: z.number().int(),
  owner: address,
  blockNumber: z.number().int(),
  token: DeploymentEntry,
  nft: DeploymentEntry,
  vault: DeploymentEntry,
  legacyVault: DeploymentEntry,
  unauditedImpl: DeploymentEntry,
});
export type DeploymentRecord = z.infer<typeof DeploymentRecord>;
