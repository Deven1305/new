# 08. Roadmap, roles, the winning path after Mumbai, and risks

"P" is the day ETHGlobal pays out Mumbai prizes. The payout date is unknown, so weeks are counted from P.

## 1. Phases

| When | Phase | Done when | Demo you can show |
|---|---|---|---|
| Tonight → 09:00 | **0. Submit HexFence alone** ([01](01_TONIGHT_SUBMISSION_PLAN.md)) | Submitted by 08:30 with the video and human items | The Mumbai demo |
| Submission → P | **Pause** | No code on HexFence. Feedback from judges and sponsors, notes, reading this plan | — |
| P → P+1 wk | **1–2. Import + one workspace** ([05](05_MERGE_STEPS.md) §3–4) | Fresh clone passes the summed baseline tests; Pages unchanged | Same site, one repo |
| P+1 → P+3 wk | **3–4. One verdict model + one extension** | Golden mapping tests; Pramaan browser suites plus the new Safe cases pass | Tampered page → red app row; lookalike SafeTx → red recipient row |
| P+3 → P+5 wk | **5. Data + dogfood + real Sepolia identities** | HexFence Pay verified from ENS with the console off; Arkiv Releases/Alerts tabs; daily snapshot | "HexFence verifies itself" |
| P+5 → P+6 wk | **6. One CRE project on a DON** | Real simulation outputs saved; real forwarder in Alerts V2 | Pending-upgrade alert before execution |
| P+6 → P+9 wk | **Integrations** | MetaMask Snap; Safe App listing request; composite-guard design; Guard V3 spec | Five rows inside MetaMask |
| P+8 → P+12 wk | **Audit + mainnet beta** | External audit done; bug bounty live; 3–5 pilot Safes (design partners); ENS mainnet (v1 or v2); Arkiv mainnet if ready, else signed files | Real treasuries protected |

Cut order if time runs short: console first, then the Snap, then the Guard V3 delay. **Never cut** the audit, honest docs or human labelling.

## 2. Suggested roles

Based on who did what in the two git histories. Adjust as the team prefers.

| Person | Owns | Why |
|---|---|---|
| Deven | Architecture, `packages/core` and the frozen INTERFACES, contracts, Arkiv layer, release process | Ran Lane A (shared, Arkiv, detector, contracts) and Pramaan's extension hardening |
| Dhruv | Extension, Pay/Safe App, browser end-to-end tests, CRE | Built Pramaan's CRE adapter, auth and browser tests, and merged most HexFence feature PRs |
| Aksaht | Console (server + web), release workflow, CI | Built Pramaan's server routes, build-time leak scan and release workflow |
| Everyone (human-only) | Guard reviews, detector labels, native-language checks, the demo | Judges and ETHGlobal value meaningful human work; an AI review is not a human review |

## 3. The winning path after Mumbai

1. **A future ETHGlobal event with a Continuity track.** Mumbai's "Extend Open Source" track lets you "bring a repo you already maintain" and ship a new feature during the event. After the merge, HexFence is that repo. Build one clearly new feature at the event (for example the MetaMask Snap, ENSv2 mainnet identities or the composite guard), with a README section separating "before" from "new", and a clean commit history. The Continuity tracks were "new for 2026" at Mumbai, so **check each event's rules**; they may not be offered everywhere.
2. **Sponsor follow-ups.** After judging, ask the Arkiv, EF (CROPS), Chainlink and ENS teams for feedback on the merged design. Their prize criteria match the layers: Arkiv for the data, ENS for release identity, EF for CROPS and security, Chainlink for the watch.
3. **Grants for the public-good parts** (the detector, evidence feed and open release format). Candidates to check, since programmes and deadlines change: the Ethereum Foundation's Ecosystem Support Program, ENS ecosystem/public-goods funding, Safe ecosystem grants, Chainlink grants, Arkiv/Golem ecosystem support and Gitcoin rounds. None were verified in this session.
4. **Design partners.** Three to five Safe-using teams (Indian Web3 teams, DAOs, a small treasury) for the mainnet beta. Their feedback is worth more than any prize.

## 4. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Judges ask whether HexFence used Pramaan | Medium | High | Planning docs in the repo ([01](01_TONIGHT_SUBMISSION_PLAN.md) step 1); the prepared Q&A answer; no Pramaan code |
| The merge breaks the live site or attestations | Medium | High | Branches, move-only commits, CI gates, `contracts/` untouched, one revertable import commit |
| ENSv2 mainnet is late | Medium | Medium | ENSv1 text records plus the timelock as the only writer |
| Arkiv mainnet is late | Medium | Medium | Signed snapshot and bucket files on Pages/IPFS |
| One-guard-per-Safe blocks adoption | High for Safe Shield users | High | Composite guard; offer the evidence feed to vendors |
| False reds annoy users | Medium | High | Human-labelled precision; warn (client) on weak lookalikes, block (Guard) only at 4+4 |
| AI-written code hides bugs | Medium | High | Human reviews, Foundry fuzz and invariant tests, external audit before mainnet |
| Three people, many parts | High | Medium | The phase order and cut order above |
| Bigger competitors (Hypernative, Blockaid) | Certain | Medium | Different position: open, ownerless, CROPS, India-first, built to work alongside them |
| Legal questions in India | Low–medium | Medium | Non-custodial by design; ask a lawyer before paid hosted services |

## 5. Decision log

| Decided in this plan | Still open (the team decides) |
|---|---|
| Tonight: HexFence alone, Classic, no Pramaan code | Whether to ask organisers the optional question in [02](02_RULES_AND_ELIGIBILITY.md) §6 |
| Merge only after payout | Final product naming (HexFence + "HexFence Pramaan" is a suggestion) |
| HexFence repo is the host; history kept with `git filter-repo` | Production timelock delay (24 h or 48 h) |
| Pramaan's extension and decoder are the bases; the Guard-parity decoder stays separate | Whether to build the Guard V3 delay at all (depends on the escape-hatch design) |
| Guard v1 never changes | Console scope (could ship later) |
| ENS = authority, Arkiv = index, mirrors serve | Which chain comes after Ethereum for the detector |
