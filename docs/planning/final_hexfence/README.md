# final_hexfence: one plan for HexFence + Pramaan

Written Fri 6 Nov 2026, about 23:00 IST. The ETHGlobal Mumbai deadline is **Sat 7 Nov, 09:00 IST** (about 10 hours away).

This folder is a **plan only**. It holds no code from either project, on purpose (see [02](02_RULES_AND_ELIGIBILITY.md)). Nothing in `../hexfence` or `../Pramaan` was changed.

## The answer in one minute

1. **Do not merge Pramaan into HexFence before the deadline. Submit HexFence alone, as it is, in Classic (From Scratch).**
   - Pramaan's code was written on 4 Nov, and its first commit (`6d30220`) is dated **5 Nov 01:01 IST**. Hacking began **5 Nov 21:00 IST**.
   - The Classic rules ban "prior project-specific code, designs, or assets". The FAQ says a team that ports or continues an existing project "won't be eligible for being an ETHGlobal Finalist".
   - HexFence's own handoff already says *"No code from the pre-event Pramaan repo"*. HexFence's code freeze started at 22:00 tonight.
2. **There can only be one submission.** The FAQ asks "Can I join two teams/projects?" and answers **"No."** Pramaan's contributors (Deven, Dhruv, Aksaht) are HexFence's team. Pramaan cannot also be submitted.
3. **Merge after prizes are paid out.** The rules say that after submission you "should not be working on your project again until PRIZES have been officially paid out". After payout, merge Pramaan **into the HexFence repo** (HexFence is the host) and keep both git histories. Steps are in [05](05_MERGE_STEPS.md).
4. **The merged product is HexFence, a pre-sign firewall with on-chain enforcement.** Before any signature it answers three questions, and the Safe enforces the answer on-chain:

   | Question | Comes from | How |
   |---|---|---|
   | Is this the real app? | Pramaan | A signed release record, anchored on ENS behind a timelock, checked against the files the page loaded |
   | Is this the real contract? | Pramaan | Bytecode and proxy-implementation hashes compared with the release, plus an upgrade watch |
   | Is this the real recipient? | HexFence | The lookalike rule against approved payees, plus open poisoning evidence on Arkiv, enforced by a Safe Guard |

## The three options for tonight

| | **A. HexFence alone, Classic** (recommended) | B. Merged, Continuity track | C. Merged, still called Classic |
|---|---|---|---|
| ETHGlobal Finalist | Eligible | Probably not (FAQ: porting or continuing → not a Finalist) | At risk of disqualification |
| Arkiv "Build on Arkiv (from scratch)" | Eligible | Lost (it is the from-scratch track) | At risk |
| EF | Best CROPS App ($3,500 pool) | Only "CROPS Upgrade to an Existing Project" ($1,500) | At risk |
| Organiser approval needed tonight | No | Yes, a track change | Not allowed at all |
| Engineering risk before 09:00 | None (freeze already on) | Very high: two monorepos, two extensions, new video | Very high |
| Honest? | Yes | Yes, if pre-event work is documented | **No**: it would misstate when code was written |

Details and exact rule quotes are in [02](02_RULES_AND_ELIGIBILITY.md).

## Read in this order

| File | What it gives you | Read it |
|---|---|---|
| [01_TONIGHT_SUBMISSION_PLAN.md](01_TONIGHT_SUBMISSION_PLAN.md) | Hour-by-hour plan to 09:00, the items that decide winning, pitch lines, judge Q&A | **Now** |
| [02_RULES_AND_ELIGIBILITY.md](02_RULES_AND_ELIGIBILITY.md) | Timeline of both repos, the rules word for word, options A/B/C, a message to organisers | Now |
| [03_BOTH_PROJECTS_AUDIT.md](03_BOTH_PROJECTS_AUDIT.md) | What each project really is, what works, what is duplicated, what each brings | After submission |
| [04_MERGED_ARCHITECTURE.md](04_MERGED_ARCHITECTURE.md) | The final product: layers, data flow, one verdict model, repo layout | After submission |
| [05_MERGE_STEPS.md](05_MERGE_STEPS.md) | Where the code goes, the history-keeping import, phase-by-phase steps with checks | After payout |
| [06_SECURITY_PLAN.md](06_SECURITY_PLAN.md) | Threat model, trust roots, keys, Guard V3 research, sandbox, supply chain | Before any mainnet use |
| [07_REAL_WORLD_INTEGRATION_AND_SCALE.md](07_REAL_WORLD_INTEGRATION_AND_SCALE.md) | Safe{Wallet}, MetaMask Snaps, ERC-7730, ENS, Arkiv, CRE, exchanges, AI agents; how it scales | Planning the product |
| [08_ROADMAP_AND_WINNING_PATH.md](08_ROADMAP_AND_WINNING_PATH.md) | 12-week roadmap, roles, future Continuity-track and grant path, risks | Planning the product |
| [09_SOURCES.md](09_SOURCES.md) | Every local file and web page used, plus what is still unverified | When checking a claim |

## What was checked

- Both repos, read-only: git history and remotes, status and handoff docs, interfaces, schemas, the Guard source and line counts.
- The ETHGlobal Mumbai site capture of 19 Oct (`../ETHGlobal_Mumbai_2026_Site_Capture.docx`). A web search on 6 Nov showed the same Classic and Continuity wording on the live rules page.
- Web research on real attacks (Bybit, WazirX, address poisoning) and on the systems the merged product must fit into (Safe Shield, Chainlink CRE, ENSv2, Arkiv, ERC-7730, MetaMask Snaps).

## Not verified

- Final eligibility is the organisers' decision. Re-read the dashboard if anything there differs from this folder.
- The prize payout date is unknown, so the roadmap counts weeks from payout, not from fixed dates.
- ENSv2 mainnet activation and the Arkiv mainnet date were not confirmed (see [07](07_REAL_WORLD_INTEGRATION_AND_SCALE.md)).
