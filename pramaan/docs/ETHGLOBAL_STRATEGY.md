# Pramaan: ETHGlobal research and execution strategy

Research checked 5 November 2026, Asia/Kolkata. This is a working strategy, not evidence of completed functionality or prize eligibility. The managing chat owns research/review; Gemini CLI now implements on `codex/gemini-work`. Terra is stopped, with its checkpoint preserved on `codex/project-start`. Verified results live in IMPLEMENTATION_STATUS.md and docs/evidence.

Latest human direction: the team will handle track/organizer questions. Engineering should continue toward complete functionality, with incremental branch commits. Section 1 preserves research context; it is not a reason to suspend authorized local work. The Claude-agent prompt reconciliation and functional completion sequence are in [COMPLETION_PLAN.md](COMPLETION_PLAN.md).

## 1. Resolve the submission boundary first

The human confirmed registration in **From Scratch**. This checkout already contains project-specific work: its initial commit `6d30220` is dated 5 November 2026 at 01:01 IST, and IMPLEMENTATION_PLAN.md and SPONSORS.md explicitly describe code written on November 4. A current commit timestamp is not evidence that the code was created during hacking.

ETHGlobal's [prior-work rules](https://ethglobal.com/rules) prohibit pre-event project-specific code, designs and assets in Classic/From Scratch. Existing-project work requires an approved Continuity path, disclosure and substantive new event work; partner eligibility can vary. Preserving history and disclosing prior work is essential.

**Recommendation:** ask the organizers promptly whether a track change is allowed and precisely which finalist and sponsor categories would remain eligible. Provide the existing repository, baseline commit and the accurate pre-event boundary. Record their answer. Do not assume that calling this a starter, opening a new branch, retyping it, resetting history or moving files into a new repository changes its status. Do not imply that a clean implementation automatically cures use of prior project-specific designs; obtain guidance if staying From Scratch. Continue this authorized local branch as existing-project development while eligibility is unresolved. No submission or mainnet deployment is authorized here.

The repository's statement that kickoff is November 5 at 21:00 is **not independently verified**: the main event and schedule pages failed to load in this research. Use the organizer/dashboard schedule to establish the actual boundary rather than repeat the repo's time as fact.

## 2. Position the product around one checkable promise

**Working pitch:** Pramaan connects a reproduced smart-contract exploit and its verified fix to the signed release a user is about to interact with, and warns or holds signing when the site or contract diverges.

The user is a small dApp team shipping its first release; the beneficiary is the person asked to approve a transaction. Start with that scenario. Do not lead with a list of scanners, models, chains, translations and sponsors. A judge should be able to follow one release digest from the developer's evidence to the extension window.

The claim is bounded: exploit reproduction establishes a specific bug under stated conditions; matching release hashes establishes integrity relative to that release. Neither establishes that the application is free of vulnerabilities. The signer, ENS owner, browser extension and supported contract assumptions remain trust roots. Display checked properties and unresolved checks separately.

## 3. What the current prize pages imply

The [Mumbai submission guidance](https://ethglobal.com/events/mumbai/info/details) lists November 7, 2026, 09:00 IST as the deadline, up to three partner selections, and a seven-minute judging slot with four minutes of presentation and three of questions. It evaluates technicality, originality, practicality, usability and wow factor. General video guidance is 2-4 minutes. AI assistance must be attributed, with meaningful human contribution and planning artifacts where applicable. These requirements do not override prior-work eligibility.

| Target | Verified requirement | Decision for Pramaan |
| --- | --- | --- |
| ENS general ENSv2, $7,000 pool | Mainnet or Sepolia, central functional use, accessible open code and live demo | Strong architectural fit; existing-code eligibility still needs confirmation |
| ENS existing-project integration, $3,000 pool | Continuity; mainnet integration | Current Sepolia plan does not satisfy this separate requirement |
| EF Anon-RPC, $5,000 pool | Default anonymized RPC reads | Consider only with demonstrated transport evidence |
| EF CROPS, $3,500 pool | Demonstrate the lead property, README CROPS section, public runnable free-software repo, no production client trackers, video at most three minutes | Security/integrity is the natural lead |
| EF CROPS existing-project upgrade, $1,500 pool | Continuity; explain and demonstrate the genuinely new property before/after | Potential fit after organizer-approved track change; repairing old code is not automatically a new property |
| Chainlink CRE, $1,500 pool | Meaningful blockchain/external-system workflow with successful CLI simulation or deployment | Third priority, only after core signing journey works |

Sources: [ENS prize page](https://ethglobal.com/events/mumbai/prizes/ens), [EF prize page](https://ethglobal.com/events/mumbai/prizes/ethereum-foundation), [Chainlink prize page](https://ethglobal.com/events/mumbai/prizes/chainlink). Amounts are pools, not expected winnings. EF places a project in at most one of its prizes. CRE simulation is sufficient for that CRE category; the separate CCIP category has different requirements.

**My recommendation, conditional on eligibility:** protect the ENS/core-integrity story first, make CROPS independence demonstrable second, and add CRE only with a real captured run. A three-minute recording can meet both general and CROPS duration guidance. Do not add unrelated integrations to fill the third selection.

There is a source discrepancy to resolve with ENS: its prize text describes ENSv2 as live, while the [official deployment page](https://docs.ens.domains/learn/deployments/) describes mainnet contracts deployed ahead of launch with resolution/registration still using v1 until launch completes. Check supported paths with the sponsor before planning any mainnet integration. This research did not verify deployment bytecode on-chain.

## 4. Prior art: what we must acknowledge

These are primary project descriptions, not independent audits of their implementations. Award labels establish recognition, not the reason judges chose them.

| Project | What the source establishes | Consequence for our claim |
| --- | --- | --- |
| [npmguard](https://ethglobal.com/showcase/npmguard-aeihd) | Cannes 2026 finalist and ENS award; describes package analysis with ENS/IPFS-published results | AI security results under ENS are already represented |
| [ENShell](https://ethglobal.com/showcase/enshell-6t95y) | Cannes 2026 finalist and CRE award; agent transaction firewall | Security plus ENS/CRE is not sufficient novelty by itself |
| [Preflight](https://ethglobal.com/showcase/preflight-0hj4z) | Describes approval decoding, pre-sign decisions and wallet policy enforcement | Plain-language approval warnings overlap directly |
| [TEE Shield](https://ethglobal.com/showcase/tee-shield-6fx8p) | Describes frontend tamper detection with on-chain hashes | Browser frontend hashes are not a first-of-kind claim |
| [WEBCAT](https://securedrop.org/news/webcat-alpha/) | Verifies signed web assets before execution, currently Firefox/MV2; describes Chromium incompatibility | Pramaan's MV3 re-fetch guard must not imply equivalent pre-execution enforcement |

The PDF's specific “Verifiable Web, HackMoney 2026” reference was not located reliably in this search. Do not list it as verified prior art until an exact primary project URL is found. WEBCAT's original announcement is from [March 2025](https://securedrop.org/news/introducing-webcat-web-based-code-assurance-and-transparency/); do not repeat an unsupported August 2026 origin date.

**Differentiation to prove:** a narrow, inspectable chain connecting an executable vulnerability example, the exact fix, release provenance, ENS permissions and delayed activation, and the live signing target. English/Hindi/Marathi explanations and explicit privacy observations make that chain usable. This is our proposed distinction; establish it through the demo rather than claim no other tool can do it.

## 5. Delivery order for Terra

### P0: stable protected signing journey

1. Keep the reproducible install/typecheck/test baseline. Pin tooling needed for local contracts, using official verified distributions in workspace-local tooling where practical.
2. Repair the existing demo orchestration/state mismatch. Start one real app with fresh local-chain deployment records and a real signed manifest; do not require all three apps before one works.
3. Prove the release identity, frontend check, called contract check and wallet hold integrate in Chrome. Build success is not browser integration evidence.
4. Trigger a real byte change on disk and assert that the underlying wallet provider is never invoked when Pramaan rejects. Restore exactly the signed bytes and repeat the valid path.
5. Show a real pending release update with ETA and an immediate revocation. Use local forks for reliable rehearsal, labelled accurately.
6. Join exploit/fix evidence to the same release. Use an actual vulnerable example and a checked patch; preserve the exploit assertion on the fixed version so it fails because the vulnerability was blocked, not because the test was weakened.

### P1: make the distinct security property legible

Add a compact evidence view using existing artifacts: release tag/digest, chain and origin, signer identity, test/evidence hashes, contract address and implementation hash. Show three meaningful states: verified; mismatch and held; unable to verify and held. Separate the release verdict from action risk: a published release can still ask for unlimited approval.

Record backend-off verification using a **fresh tab or cleared verification state**, not only an already-green badge. It must perform fresh ENS/manifest checks successfully without the Pramaan API; do not turn off the origin that serves the dApp or an indispensable local chain and then call that a failed independence test. State remaining RPC, host and signature-root dependencies.

### P2: optional sponsor depth

Only after P0/P1, demonstrate privacy routing and/or a CRE alert. Preserve an honest fallback if unavailable. Do not expand to additional chains, AI oracle analysis, broad exploit generation, on-chain alert writes, a full marketplace backend or a new mobile wallet for prize optics.

## 6. Acceptance evidence matrix

These are requested verification cases, **not current pass claims**. Terra should put outcomes and artifact paths in IMPLEMENTATION_STATUS.md.

| Scenario | Observable acceptance evidence |
| --- | --- |
| Clean checkout | Frozen install, workspace typecheck, relevant tests and documented build commands succeed |
| Genuine release | Extension derives identity, verifies signature/digest and current contract; approved request reaches provider once |
| Changed frontend | Actual served JS differs; extension explains file mismatch; provider invocation count zero |
| Restored frontend | Original signed bytes recover valid path without editing manifest |
| Lookalike origin | Manifest copied to second origin fails domain binding |
| Wrong signer/digest | Authentic bundle for wrong artifact or identity rejected |
| Unsupported/missing read | Unknown/amber and signing hold; never green by fallback |
| Two RPCs disagree | Explicit disagreement; compare same block if supported to avoid mere head drift |
| Wrong chain | Request chain and deployed contract identity cannot silently cross networks |
| Changed proxy implementation | Supported proxy resolves to new code; mismatch blocks |
| Queued release | Pending pointer/ETA visibly differs from active release; cannot execute early |
| Unauthorized ENS writer | Proposer cannot write record directly or change other keys; sibling resolver unaffected |
| Revocation/replay | Revoked digest rejected; old executed release cannot be reactivated through proposer |
| Session lifecycle | Navigation, tab close, worker timeout or verdict-window close rejects the held request |
| Unlimited approval | Actual spender, token and unlimited amount explained; risk remains high in all languages |
| Private read | Successful anonymized path plus failure with fallback disabled; explicit direct fallback otherwise |
| Leak fixture | Observer distinguishes attempted exposure from delivered traffic; blocking demonstrated after rule install |
| Independent verifier | Fresh checks succeed with Pramaan backend unavailable |
| CRE | Actual successful CLI run, real inputs, captured decision and receipt; duplicate alerts suppressed |

Protect against misleading tests: fakes can verify policy logic but cannot establish real RPC privacy, actual resolver compatibility, real wallet interception, or DON deployment. Report each category separately.

## 7. Technical research findings and actionable cautions

**ENSv2:** [Permissioned Resolver docs](https://docs.ens.domains/ensv2/permissioned-resolver/) say key-scoped grants apply across every name served by that resolver. Separate resolver instances are therefore substantive isolation, not decoration. `grantSetterRoles` scopes a setter argument; root roles are broader. Reads use `resolve(DNS-name, profile calldata)`, not standalone text getters. Current CRE `src/reads.ts` directly calls `text(namehash,key)`, a concrete integration defect to test against a real resolver. Preserve the owner/admin upgrade trust assumption: the timelock does not remove owner power.

**Browser boundary:** [Chrome's content-script documentation](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) distinguishes isolated scripts from scripts sharing the page's MAIN environment. Existing `content.ts` re-fetches assets with force-cache and explicitly documents targeted-cloaking/TOCTOU exposure. Existing provider wrapping cannot claim universal wallet-level protection against all malicious page code. Do not say no malicious code executed. Avoid green for unsupported critical resources; assess data/blob/dynamic scripts, not only filename suffixes. Final submission should distinguish the demonstrated tamper attack from uncovered adversaries.

**Provenance:** [GitHub artifact-attestation guidance](https://docs.github.com/en/actions/concepts/security/artifact-attestations) establishes provenance, not secure behavior. Existing signature verification checks workflow/repo/tag identity, source commit and subject digest; retain all bindings. A release-key demo is a different mode from a successful GitHub attestation. A matching signer alone is insufficient.

**Anon-RPC:** the [official adopter list](https://ethereum.github.io/anon-rpc/adopters/) distinguishes passthrough (no anonymity) from real networks and identifies Nox on Sepolia. Its [specification](https://ethereum.github.io/anon-rpc/spec/) makes worker hash verification and isolation security-critical. Existing transport comments disclose direct bootstrap, per-call path logging and direct fallback. Show real call paths and latency; do not label all app/wallet traffic anonymous merely because Pramaan's verification reads are routed. Avoid recording personal RPC payloads in evidence exports.

**CRE:** [EVM client reference](https://docs.chain.link/cre/reference/sdk/evm-client-ts) supports contract calls/log filtering; do not assume ethers/viem methods all exist. Source helper modules currently lack a runnable workflow entrypoint/SDK adapter/config. [Simulation guidance](https://docs.chain.link/cre/guides/operations/simulating-workflows) explains local execution and optional broadcast; a simulation is not a decentralized deployment. Alert HMAC authenticates possession of a shared secret; it is not public proof of DON consensus. Keep read failure/insufficient log coverage UNKNOWN rather than assert an implementation is unchanged. A proxy event is evidence only under the supported proxy model.

## 8. Demo and submission package

Target a three-minute spoken recording, with a longer four-minute live version. These timings are proposed editing targets:

| Time | Show | Evidence focus |
| --- | --- | --- |
| 0:00-0:15 | Developer ships a fixed vault; user needs to know this is that release | One plain problem, no lengthy threat statistics |
| 0:15-0:45 | Exploit passes on vulnerable code, checked fix blocks it, regressions pass | Actual terminal result and artifact ID |
| 0:45-1:10 | Signed manifest and timelocked ENS record identify release | Same digest and least-privilege rule |
| 1:10-1:35 | Genuine site/contract and exact approval in extension | Transaction explanation with one Hindi example |
| 1:35-2:05 | Change deployed JS; attempt signing; rejection before wallet | Real mismatch and zero provider calls |
| 2:05-2:30 | Backend off; fresh verification still works | CROPS property at the moment it matters |
| 2:30-2:50 | Queue/update alert or revocation, if verified | Sponsor-specific real evidence |
| 2:50-3:00 | State what is new and what remains limited | Accurate scope and next adopter |

Do not wait through a timelock on camera: show genuinely recorded queue time and later execution, clearly explaining the edit. Avoid an unrehearsed install during judging. Pre-open the app, extension and evidence. Keep a labelled backup recording; do not call recorded Sepolia activity live.

Prepare a judge entry in the public README: one-paragraph problem, exact run steps, supported networks/proxies, architecture, current limitations, prior art, CROPS, sponsor evidence links, prior-work boundary and AI attribution. Include a short mapping from each sponsor claim to file, command, artifact and video timestamp. Never replace missing transactions with typed examples that look executed.

Questions the human team should be able to answer without an agent: why ENS permissions matter; who can bypass the timelock; what a signature proves; why a failed exploit is not an audit; what malicious JavaScript can bypass; who learns IP/addresses; which work happened during hacking. Have a builder rehearse with another person who has not read the repo. Treat observed confusion as a UI defect.

## 9. Finish gates and current result

Internal readiness gates, not predictions of judging: (1) eligibility resolved; (2) fresh checkout reproducible; (3) genuine release + real tamper hold recorded; (4) independent checks recorded; (5) selected sponsors each have actual evidence; (6) human demo rehearsal and submission materials complete. Any failed gate gets an explicit limitation or scope cut.

At the latest worker update, Terra reports workspace typecheck and 143 selected non-Forge tests passing, local web/API startup, and real unlimited-approval decoding. Core browser E2E, real ENS release and CRE remain unverified. Most backend routes are intentionally unfinished (501), readiness reports incomplete integration (503). These are progress toward the product, not completion of P0.

The immediate human action is organizer clarification of the From Scratch/prior-work conflict. The immediate implementation priority is the real signed-release browser journey. Research and local work can continue while that clarification is pending.
