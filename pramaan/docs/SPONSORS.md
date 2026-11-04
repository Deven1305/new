# Pramaan: sponsors, what we use from each, and why

Pramaan targets **three partners**: **ENS**, **Ethereum Foundation (Anon-RPC / CROPS)** and **Chainlink (CRE)**.
ETHGlobal allows at most 3 partner prizes per project, and a partner's several tracks count as one.

The prize facts below come from the team's research notes (`../PRAMAAN_ Verified Research…md`, checked against the official prizes page). Re-check the live prize page at check-in, because tracks can change.

---

## 1. ENS — "Best Use of ENSv2" (Sepolia allowed)

**What ENS is in Pramaan:** the **release identity** of every app. A dApp's "official latest release" is not stored on our server. It is an ENS text record that anyone can read on-chain.

| ENSv2 feature | How Pramaan uses it |
|---|---|
| **Names and subnames** (hierarchical identities) | One parent name for the team, with one subname per app: `vaultlab.<parent>.eth`, `mirroryield.<parent>.eth`, `permitmarket.<parent>.eth`. If ENSv2 Sepolia cannot create subnames, the fallback is three separate `.eth` names, documented with evidence in `docs/ENS.md`. |
| **Permissioned Resolver** (one per app) | Holds that app's records: `pramaan.record` (the active release pointer `pramaan:v1:<tag>:<sha256>`), `pramaan.domain` (the only website origin allowed to claim the release), `pramaan.signer` (release-signing public key), `pramaan.attestation` (signature policy), `pramaan.revoked` (revoked releases). |
| **Scoped roles** (`grantSetterRoles` on one text key) | The **PramaanTimelock** may write only `pramaan.record`. The **guardian** may write only `pramaan.revoked`. The release pipeline (proposer key) cannot write any record at all, only queue a change in the timelock. The negative tests prove that unauthorised writes revert on the real contracts. |
| **Timelock-controlled updates** | A new release is queued, waits the delay (120 s in the demo), and is then executed. Anyone watching (the extension, the monitor, CRE) sees the pending change *before* it takes effect. |
| **Supersession and revocation** | A newer pointer supersedes the old one, and an old pointer cannot be re-activated. The guardian can revoke instantly, because revoking only ever reduces trust. |
| **Browser verification** | The extension resolves the records itself through the ENSv2 Universal Resolver, from two RPCs that must agree. Our backend is not involved. |

**Why ENS:** a release needs a name that users and wallets can look up, that isn't controlled by our server, and whose write permissions can be split. ENSv2's permissioned resolvers and scoped roles do exactly that, so ENS is central to the product rather than a decorative link.

**Prize requirements we meet:**
- ENS is central to the design.
- No hard-coded values: names and addresses come from configuration and on-chain reads.
- There is a live demo.
- The code is open source (once the repo is public).

---

## 2. Ethereum Foundation — "Best Use of Anon-RPC" (alternative: "Best CROPS App")

**Pick ONE EF track when submitting.** The research notes say a project is placed in at most one EF track.
- **Recommended: Anon-RPC.** Its requirement is concrete: "your app routes its RPC reads through Anon-RPC by default". Our extension does that for its verification reads on Sepolia.
- **Choose CROPS instead** if Anon-RPC on Sepolia is unreliable at demo time. The track's example idea is "a tool that shows what an app leaks (RPC calls, trackers, metadata)", which is our leak detector.

| Part | How Pramaan uses it |
|---|---|
| **Anon-RPC** | The extension's verification reads (chain id, ENS records, `eth_getCode`, `eth_getStorageAt`, `eth_call`) go through Anon-RPC by default on Sepolia, falling back to direct RPC if it fails. A Privacy panel shows, per check, which reads went through Anon-RPC and which went direct. It also shows what each provider can and cannot see: IP address, queried names and addresses, timing. The local demo chain (anvil, chain id 31337) cannot use Anon-RPC, and the panel says so. |
| **C — Censorship-resistant** | A site can be verified from ENS plus the manifest fetched by hash, from the site itself, IPFS or any mirror. Our backend can be switched off and verification still works. |
| **O — Open source** | MIT-licensed repo, reproducible build, and a CLI anyone can run (`pnpm pramaan verify <url>`). |
| **P — Private** | Anon-RPC reads, and detection of wallet-address leaks to third parties (incl. encoded forms), with one-click blocking. The extension sends nothing to Pramaan. |
| **S — Secure** | Signed manifests, a timelock, least-privilege keys, a sandboxed analysis engine, and a documented threat model (`docs/THREAT_MODEL.md`). |

**Why EF:** "is this website the one that was audited, and is it leaking my address?" is exactly the CROPS problem. Anon-RPC fixes one leak: what the RPC provider learns from our verification reads. Leak detection covers the other: what the website itself sends to trackers. They are separate features, and we keep them separate.

---

## 3. Chainlink — CRE (Chainlink Runtime Environment)

**What CRE is in Pramaan:** the **independent watchdog** (WATCH).

| Part | How Pramaan uses it |
|---|---|
| **Cron trigger** | The workflow runs on a schedule. |
| **EVM client** (`callContract`, `filterLogs`) | Reads, for each of the three apps: the active ENS pointer, revocations, pending operations in PramaanTimelock, scheduled proxy upgrades in VaultLab's TimelockController (`CallScheduled`), and `Upgraded` events. |
| **HTTP client with node consensus** | Fetches the active manifest and checks that its sha256 equals the hash in the ENS pointer. |
| **Fixed decision rule** | Every run returns one of: OK, PENDING_RELEASE_CHANGE, PENDING_UPGRADE, UNEXPECTED_IMPLEMENTATION, RELEASE_REVOKED, MANIFEST_MISMATCH or UNKNOWN. The same inputs always give the same answer, and UNKNOWN is never treated as OK. |
| **Signed alert** | Sends an HMAC-signed alert to the Pramaan backend, which forwards it to Telegram. Alerts are idempotent, so repeated runs don't spam. |

**Why CRE:** a monitor that runs only on our own server is a single point of trust. CRE runs the same check across a decentralised node network, with consensus on what it fetched. The alert before a timelocked upgrade comes from a **real pending operation and the real delay**; nothing is faked.

**Prize requirement:** the prize page says "It is NOT mandatory to deploy… simulation is enough!". We submit a real `cre workflow simulate` run plus its captured output. Deploying to the CRE network needs a CRE account or early access; that step is prepared but only claimed if it actually happens.

---

## Why these three and not the others

| Partner | Why not |
|---|---|
| Uniswap | It would only fit through contrived v4-hook exploit templates, and it doesn't serve the product. |
| 0G | Their track excludes apps "where the AI call could be removed without anyone noticing". Our core is deliberately deterministic, and AI is optional. |
| World, Hedera, Arc, Arkiv, Whitechain, 1inch, Definitive | Each needs a different chain, identity system or product focus. Bolting them on would be artificial. |
| IPFS, Filecoin, Pinata | They are not prize partners at this event. IPFS stays an optional storage path, not a prize target. |

---

## ⚠ Eligibility checks the team must do before submitting

1. **Classic vs. existing-project rules.** ETHGlobal's Classic rules say all project work must begin after the hackathon starts (kickoff 5 Nov 21:00), with no prior project-specific code. This codebase was written on 4 Nov. Confirm with the organisers which track the team is registered in and whether this code may be submitted. Do not submit it to Classic if that isn't allowed.
2. **AI usage.** ETHGlobal says AI should assist, not create the entire project. Keep `AI_USAGE.md` honest about what AI generated.
3. **One EF track only.** Choose Anon-RPC or CROPS.
4. Never describe a CRE simulation as a deployment, or a local anvil fork as Sepolia.
