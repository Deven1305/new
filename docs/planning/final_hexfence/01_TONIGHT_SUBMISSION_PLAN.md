# 01. Tonight: submit HexFence and give it the best chance to win

Goal: an eligible, strong HexFence submission by **08:30 IST** (deadline 09:00), and a presenter who is awake and ready for **Finalist judging at 09:30**.

This follows option A from [02](02_RULES_AND_ELIGIBILITY.md): HexFence alone, Classic (From Scratch), no Pramaan code. HexFence's own [TEAM_HANDOFF](../hexfence/docs/TEAM_HANDOFF.md) is the source of truth for owners and open items. This file puts them in winning order.

## If you only have two hours

Do these in this order and stop when time runs out:

1. Record and upload the video (no video, no judging).
2. Human Guard sign-off (it proves a person checked the core contract).
3. The planning-artifacts PR in step 1 below (15 minutes; it closes a rules gap).
4. Fill the submission form from [SUBMISSION.md](../hexfence/docs/SUBMISSION.md) and submit.

## Step 0. Team call, 10 minutes (23:00–23:20)

- [ ] Everyone agrees: **no Pramaan code, no retyped Pramaan code and no new Pramaan-style features in HexFence tonight.**
- [ ] On the ETHGlobal dashboard: the project is **HexFence**, every teammate is on it, and the track is **Classic / From Scratch**. Each hacker can be on only one project.
- [ ] Someone is still committing to Pramaan (the last commit was 22:43 tonight, "Public record page…"). That work cannot count for this submission. Pause it and move those hours to step 2.
- [ ] Pick one presenter for 09:30. That person sleeps first (step 3).

## Step 1. Close a rules gap with a docs-only PR (23:20–23:50)

ETHGlobal says: *"If you use [a spec-driven workflow], you must include all spec files, prompts, and planning artifacts in your submission repository."*

The repo relies on a plan that is not in it. [PROGRESS.md](../hexfence/docs/PROGRESS.md) lines 96 and 100 say "the upgrade plan supersedes the locked spec", and [AI_USAGE.md](../hexfence/docs/AI_USAGE.md) line 71 says an agent "read the … external upgrade plan". But `13_HexFence_Upgrade_Plan.md` is only in `my/eth/`, not in `hexfence/docs/planning/`. (Checked against `origin/main` at 23:00.)

On a branch `docs/planning-artifacts`, through a PR as the handoff requires:

1. Copy `../13_HexFence_Upgrade_Plan.md` and `../13_HexFence_Upgrade_Plan.pdf` into `hexfence/docs/planning/`.
2. In README "What's new vs reused", add one sentence. Suggested wording, edit as you see fit: *"Two feature ideas (B6 explain layer, B7 client attestation) came from the team's pre-event research notes, as `docs/planning/13_HexFence_Upgrade_Plan.md` §4 records; no code from those projects is used."* That plan's §4 already says this, so the sentence only makes it easy to find.
3. If you follow this file tonight, also add it as `docs/planning/agent-reports/final-hexfence-tonight-plan.md`. It is a planning artifact too.

This is documentation, so it fits the freeze. Do not touch code in the same PR.

## Step 2. The human items that decide winning (23:30–03:30, in parallel)

Judges score Technicality, Originality, **Practicality**, Usability and WOW. ETHGlobal also says submissions "that rely entirely on AI without meaningful contributions from team members may not be eligible for partner prizes or finalist consideration". These items are the human contribution, so they matter twice.

| # | Item | Owner (from the handoff) | Time | Why it matters | If it is not done |
|---|---|---|---|---|---|
| 1 | Read [GUARD_REVIEW.md](../hexfence/docs/GUARD_REVIEW.md) and the Guard source; sign off; fill `‹GUARD_REVIEWER›` | A team member | 45 min | Human review of the core contract; Q&A depth | Say in AI_USAGE that no human review was done |
| 2 | H6: real wallet run on the demo Safe | Dhruv | 30–45 min | "A person ran it", plus the video's live-send step | Show the scripted transactions, labelled "scripted" |
| 3 | `cre login`, then the simulation in [CHAINLINK.md](../hexfence/CHAINLINK.md); save the real output to `sentinel/SIMULATION.md` | A person with a Chainlink account | 30–60 min | It is the gate for the Chainlink prize | Select only Arkiv and EF. Two strong entries beat a third weak one |
| 4 | H10: Hindi check by a native speaker | A teammate | 20 min | Usability for Indian users | Keep "not yet reviewed by a native speaker" |
| 5 | H9: check the 30 rows on Etherscan | A person, not an AI | 45–60 min | Gives a real precision number | Delete the `‹PRECISION›` sentence |
| 6 | T14 extension go/no-go, B8 Safe App try | Dhruv / anyone | 30 min each | Optional extra claims | Leave them in Limits |

Record what each person did in `docs/AI_USAGE.md` ("people did"). Use names, times and what was checked.

## Step 3. Sleep in shifts (03:30–06:30)

The presenter sleeps at least 2–3 hours. A tired 4-minute pitch loses more points than any missing feature.

## Step 4. Video (06:30–08:00)

- Length **2:30–3:00**. ETHGlobal allows up to 4:00, but the EF CROPS prize asks for at most 3:00.
- A person's own voice; at least 720p; a screen recording, **not a phone camera**; **no speed-up** ("Attempts to speed-up video will disqualify your submission").
- Script: [docs/DEMO.md](../hexfence/docs/DEMO.md). The decisive shot is the lookalike payment reverting on-chain with Pay out of the path.
- Upload and fill `‹VIDEO_URL›`.

## Step 5. Submit (08:00–08:30)

- [ ] Paste from [SUBMISSION.md](../hexfence/docs/SUBMISSION.md). Search the pasted text for `‹`; none may remain.
- [ ] Partners: **Arkiv** (Build on Arkiv, from scratch) and **EF Best CROPS App**, plus **Chainlink** only if `sentinel/SIMULATION.md` holds real output.
- [ ] `git log -p` search for keys or seed phrases (their checklist).
- [ ] Repo is public: it is (GitHub API returned 200 at 23:00).
- [ ] Submit by 08:30. Keep 08:30–09:00 as buffer.

**After you press submit, push no more code until prizes are paid.** The FAQ: "you should not be working on your project again until PRIZES have been officially paid out / distributed."

## Pitch lines you can add (words only, no new code)

Each line below is checked against the code or a source in [09](09_SOURCES.md):

- *"Address poisoning is not rare. A USENIX Security 2025 study found 270 million attacks against 17 million victims on Ethereum and BSC over two years, with at least $83.8 million lost."*
- *"The $1.5 billion Bybit theft in February 2025 came from a tampered Safe{Wallet} page that made signers approve a delegatecall. HexFenceGuard refuses every delegatecall (`DelegateCallNotAllowed`), and it refuses lookalikes of approved payees, even if every screen lies."* This is true per [HexFenceGuard.sol:94-95](../hexfence/contracts/contracts/HexFenceGuard.sol#L94-L95). Do not say it "would have stopped Bybit". The honest limit: a tampered page could first ask owners to remove the Guard, which is a separate Safe transaction.
- *"The rule lives in the account. Our site, detector and Arkiv records can all disappear, and the Safe still refuses the lookalike."*

## Judge Q&A: short honest answers

| Question | Answer |
|---|---|
| Is this related to your other repo, Pramaan? | Pramaan is a private prototype some of us built before the event. HexFence started after kickoff (first commit 6 Nov 01:19 IST) and contains no Pramaan code. Two feature ideas came from our pre-event notes, as `docs/planning` records. Combining them is our post-event roadmap. |
| What did people do, and what did AI do? | Point to `docs/AI_USAGE.md`, then name tonight's human items: Guard sign-off, the wallet run, the Hindi check, the labels. |
| Safe already has Safe Shield (Hypernative Guardian, Blockaid). Why HexFence? | Guardian is a vendor's policy service and Blockaid flags risk. HexFenceGuard has no owner and no upgrade path, and reads nothing off-chain. The evidence is open on Arkiv and anyone can publish it. A Safe holds one transaction guard at a time, so working alongside Guardian needs a composite guard; that is on our roadmap. |
| False positives? | The fingerprint is 8 hex characters (32 bits). A random different address matches one approved payee's fingerprint with odds of about 1 in 4.29 billion. The Guard also refuses two approved payees with one fingerprint (`FingerprintAlreadyApproved`). |
| What does it miss? | Weaker lookalikes (for example 3+3 characters), first-use mistakes, and calls other than ETH, `transfer` and `transferFrom`. They are listed in the README. |
| Why refuse MultiSend? | It is a delegatecall, so the Guard cannot see what it will do, and it fails closed. Our post-event plan allows only the canonical MultiSendCallOnly contract by code hash and checks each inner call ([04](04_MERGED_ARCHITECTURE.md)). |
| Why Arkiv? | Open, queryable, expiring evidence with publisher attribution. Bulk reads mean the address you check never leaves your browser. |

## Do not do tonight

- Do not copy, port or retype Pramaan code or designs into HexFence. Pramaan's own [strategy doc](../Pramaan/pramaan/docs/ETHGLOBAL_STRATEGY.md) warns that "retyping it, resetting history or moving files into a new repository" does not change its status.
- Do not rewrite, squash or re-date git history in either repo.
- Do not make large single commits ("Submissions with large single commits or missing histories may be disqualified").
- Do not add a new partner (for example ENS) just to fill the third slot.
- Do not claim anything in the "Not done" column of the handoff.
- Do not push code after submitting.
