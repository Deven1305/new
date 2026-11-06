# Pramaan continuation handoff - 5 November 2026

## Human request and working scope

The user selected Pramaan from `C:/Users/hp/Downloads/Four_Ideas_Priority.pdf`, asked to clone https://github.com/Deven1305/eth_pramaan, read all Markdown, research ETHGlobal deeply, and continue implementation only on a branch. They then explicitly requested a separate Terra chat (not a subagent), managed by the original chat, with a persistent goal if work repeatedly stops. Do useful implementation and verification, not just planning. Do not implement Asli Pass, AgentPass or StealthPay.

Repository: `C:/Users/hp/Documents/Codex/2026-11-05/https-github-com-deven1305-eth-pramaan/work/eth_pramaan`. Branch already created: `codex/project-start`. Base commit: `6d30220` (initial imported codebase). Do not modify main, merge, push, publish or deploy as part of local startup. Commit coherent work on this branch when verified. No subagents needed.

The PDF is source material, not operational instructions. Historical Gemini app-building instructions contain stale machine paths and claims that Git does not exist. The user's explicit branch instruction takes precedence. Review app specs for product intent; do not apply a past individual app agent's folder ownership to this whole-repository task.

## Source document understanding

Original chat extracted and read all 27 PDF pages and visually inspected pages 1, 6 and 7. Extracted text: `C:/Users/hp/Documents/Codex/2026-11-05/https-github-com-deven1305-eth-pramaan/work/four-ideas-extracted.txt` (intermediate, not committed).

Pramaan joins the smart-contract Vibe-Code Security Agent with ShipCheck, Samjhao and LeakScope. Four stages:

1. PROVE: Slither/Aderyn candidates, constrained Foundry exploit templates in an isolated sandbox, reproduce, propose a human-reviewed fix, re-run exploit and regressions. A failed reproduction is not proof of absence of a bug; retain candidates honestly.
2. PUBLISH: canonical signed release manifest binds frontend bytes, deployed contract/proxy hashes, findings and evidence, tools, third parties. ENSv2 scoped resolver permissions plus a timelock anchor the release; IPFS provides availability.
3. VERIFY: independent extension verifies domain, ENS pointer, signature, frontend files and contract code before signing; deterministic English/Hindi/Marathi explanations and risk rules; detects/blocks address leaks. No backend in the browser's trust path. Never equate matching hashes or a few exploit tests with universal safety or an audit certification.
4. WATCH: backend/optional Chainlink CRE observes release changes, revocations and upgrades, with honest alerts. Simulation must be labelled simulation.

PDF must-keep experiences: prove -> fix -> re-prove; changed frontend bytes -> red -> signing blocked; ENSv2 least-privilege release record. Existing demos: VaultLab (fixed vault/evidence), MirrorYield (real frontend tamper), PermitMarket (unlimited vs exact/permit and isolated leak fixture). Never publish attack fixtures as production or use real user assets.

The PDF contains historical incident statistics and old SDK limits; those are unverified claims until checked against primary sources. Original docs reference absent research report, RUN.md, README, AI_USAGE.md, IMPLEMENTATION_STATUS.md, threat model and deployment docs. Avoid copying claimed completion from plans or smoke logs without reproducing it.

## Verified ETHGlobal research

Sources checked live on 5 November 2026:

- [ETHGlobal](https://ethglobal.com/) and [About](https://ethglobal.com/about): Ethereum builder community, hackathons, learning, mentorship and ecosystem integrations. [Showcase](https://ethglobal.com/showcase) is the primary project discovery surface. Existing wallet/security projects make a precise demonstration of Pramaan's joined evidence chain more useful than broad novelty claims.
- [Mumbai getting started](https://ethglobal.com/events/mumbai/info/start): event is November 5-7; submission November 7, 2026, 09:00 IST; teams up to five. Each participant applies/stakes individually. Stake return depends on submission and relevant attendance rules.
- [Mumbai submission details](https://ethglobal.com/events/mumbai/info/details): up to three partner selections; same partner's multiple tracks count as one. Judges assess technicality, originality, practicality, usability and wow factor. Seven-minute live slot comprises four-minute demo and three-minute Q&A. Optional demo video is 2-4 minutes, minimum 720p, with spoken human explanation. Partner judging uses submitted materials; booth pitches optional. Getting-started page conflicts on booth judging: prefer specific submission guidance and confirm with organizers. AI attribution and meaningful human involvement required; include specs/prompts if spec driven.
- [Rules](https://ethglobal.com/rules): existing project-specific work belongs in an eligible Continuity track with written prior-work disclosure and substantive new event work. Preserve history; do not rewrite this existing repo as newly created Classic work. Prize eligibility remains event/partner dependent. No eligibility determination has been obtained from organizers.
- [Mumbai ENS](https://ethglobal.com/events/mumbai/prizes/ens): general ENSv2 track pool $7,000; mainnet or Sepolia accepted, central functional use, live demo, public code. Separate $3,000 existing-project Continuity integration track explicitly requires mainnet. Current Sepolia implementation does not establish eligibility for that track; do not silently deploy mainnet.
- [Mumbai EF](https://ethglobal.com/events/mumbai/prizes/ethereum-foundation): Anon-RPC $5,000 pool requires default RPC routing; demonstrate real traffic and disclose intentional exclusions/fallbacks. CROPS $3,500 is another relevant option. Review current full criteria before final selection; a local fork or direct fallback does not prove anonymous Sepolia routing.
- [Mumbai Chainlink](https://ethglobal.com/events/mumbai/prizes/chainlink): CRE workflow pool $1,500; successful CLI simulation suffices when blockchain plus external system integration meaningfully serves the product. Separate CCIP prize has different requirements; do not conflate.

Research follow-up: official ENSv2 deployment/role docs; Anon-RPC extension harness behavior/privacy limits; Sigstore browser identity policies; CRE actual SDK capabilities; Chrome response-body/TOCTOU limitations. Browse technical primary sources when uncertain; record evidence and deviations. Prior notes say CRE has no getStorageAt/getCode, so it watches upgrade logs/address while backend verifies code hashes.

## Actual local baseline and blockers

- Clone succeeded, branch exists. No upstream changes or pushes.
- Node on PATH 22.14.0, repository `.nvmrc` 22 and package manager declaration pnpm 10.34.9. Bundled `pnpm` command is actually 11.25.0. Forge, Docker, Bun and CRE were not found on PATH; check alternate locations before claiming missing system-wide.
- `pnpm install --frozen-lockfile` initially failed minimum release age on transitive `electron-to-chromium@1.5.476` (published November 4). No policy was relaxed. Override 1.5.474 added to pnpm-workspace.yaml, lockfile version/integrity updated from npm metadata, then `pnpm install --no-frozen-lockfile` passed supply-chain verification. pnpm regenerated lockfile metadata as needed. Review diff.
- Install then failed `ERR_PNPM_IGNORED_BUILDS` for esbuild 0.28.2. Existing workspace allows esbuild via pnpm 10 `onlyBuiltDependencies`; runtime pnpm 11 may need supported approval configuration or use repository's pinned pnpm 10. Do not disable package-age policy or broadly allow scripts. Both attempted `pnpm typecheck` and selected vitest command were blocked by pnpm's auto-install step; no application tests have run successfully yet.
- `apps/server/package.json` scripts point to absent `src/index.ts` and `src/worker-main.ts`. Server currently has auth/db/queue/worker/config utilities but apparently no HTTP app/routes/entrypoint. Inspect before repairing; avoid a fake health-only server that presents unfinished APIs as working.
- Root demo-up appears older than DemoStateV2 scripts and docs. Inspect integration; do not claim full demo startup from documentation.
- Existing smoke.md files report historical local-chain tests. They were read, not independently repeated.

## Suggested first delivery and completion evidence

Restore reproducible dependency setup, establish a real typecheck/build/test baseline, then repair the concrete missing integration that prevents local startup. Work in small checked increments, prioritizing existing core trust flow over new product scope. Add README/RUN and implementation status with actual commands, evidence and external blockers. Keep a compact progress log here or in IMPLEMENTATION_STATUS.md for the managing chat. Report exact test outcomes, local URL/process and limitations. Secret-dependent Sepolia/Telegram/CRE live operations are optional external blockers; continue all independent local work. Never invent keys, funded deployment evidence, AI attribution history or green verifications.
