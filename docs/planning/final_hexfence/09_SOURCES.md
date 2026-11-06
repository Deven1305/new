# 09. Sources, and what is still unverified

Everything in this folder comes from the sources below, checked on 6 Nov 2026 between 22:43 and 23:10 IST.

## Local files (read-only)

| File | Used for |
|---|---|
| [ETHGlobal_Mumbai_2026_Site_Capture.docx](../ETHGlobal_Mumbai_2026_Site_Capture.docx) (captured 19 Oct) | Rules, FAQ, tracks, prizes, schedule, judging criteria |
| [hexfence/README.md](../hexfence/README.md) | HexFence architecture, deployments, limits, CROPS |
| [hexfence/docs/TEAM_HANDOFF.md](../hexfence/docs/TEAM_HANDOFF.md) | Freeze times, open human work, "No code from the pre-event Pramaan repo" |
| [hexfence/docs/JUDGE_READINESS.md](../hexfence/docs/JUDGE_READINESS.md) | Partner requirements and gaps |
| [hexfence/docs/SUBMISSION.md](../hexfence/docs/SUBMISSION.md) | Submission text, partner choices, checklist |
| [hexfence/docs/INTERFACES.md](../hexfence/docs/INTERFACES.md) | Verdict and evidence types |
| [hexfence/docs/PROGRESS.md](../hexfence/docs/PROGRESS.md) lines 96, 100; [AI_USAGE.md](../hexfence/docs/AI_USAGE.md) line 71 | The repo relies on the upgrade plan |
| [hexfence/arkiv/schema.md](../hexfence/arkiv/schema.md) | Arkiv entities, expiry, release prototype |
| [HexFenceGuard.sol](../hexfence/contracts/contracts/HexFenceGuard.sol) lines 93–95 | Admin calls pass; delegatecall reverts |
| [Pramaan/pramaan/EXPLANATION.md](../Pramaan/pramaan/EXPLANATION.md) | Pramaan's four parts and test results |
| [Pramaan/pramaan/docs/ETHGLOBAL_STRATEGY.md](../Pramaan/pramaan/docs/ETHGLOBAL_STRATEGY.md) | Registration in From Scratch, the pre-event boundary, ENS/EF/CRE prize terms, prior art |
| [Pramaan/pramaan/docs/IMPLEMENTATION_STATUS.md](../Pramaan/pramaan/docs/IMPLEMENTATION_STATUS.md) | What is real vs pending |
| [Pramaan/pramaan/docs/SPONSORS.md](../Pramaan/pramaan/docs/SPONSORS.md) | ENS records and roles, Anon-RPC, CRE design |
| `Pramaan/pramaan/packages/manifest/src/schema.ts`, `packages/verifier-core/src/verdict.ts` | Release-record fields, verdict rows |
| `Pramaan/pramaan/docs/evidence/cre-*.json` | CRE: WASM built; simulation "NOT RUN"; live results from a harness, "NOT cre workflow simulate" |
| `Pramaan/pramaan/.gitignore`, `LICENSE`, `workflows/cre-monitor/pramaan-monitor/secrets.yaml` | Secret hygiene and licence before any import |
| [13_HexFence_Upgrade_Plan.md](../13_HexFence_Upgrade_Plan.md) §4 | Pramaan *ideas* behind B6/B7; "no code from the Pramaan or TraceBack repos" |
| [10_FINAL_What_To_Build_HexFence.md](../10_FINAL_What_To_Build_HexFence.md) line 293 | "No Pramaan code (it was built before the event and isn't eligible)" |
| `git log --all` in both repos; GitHub API visibility check | Timeline, authors, commit counts, public/private |

## Web

**ETHGlobal**
- [Mumbai rules, submission and judging](https://ethglobal.com/events/mumbai/info/details)
- [Mumbai prizes](https://ethglobal.com/events/mumbai/prizes/)

**Attacks**
- Bybit: [NCC Group technical analysis](https://www.nccgroup.com/research/in-depth-technical-analysis-of-the-bybit-hack/), [SlowMist](https://slowmist.medium.com/bybits-1-5-billion-theft-unveiled-safe-wallet-front-end-code-tampered-84b78f0fa9c2), [Cyfrin](https://www.cyfrin.io/blog/safe-wallet-hack-bybit-exploit), [BleepingComputer](https://www.bleepingcomputer.com/news/security/lazarus-hacked-bybit-via-breached-safe-wallet-developer-machine/amp/)
- WazirX: [Wikipedia](https://en.wikipedia.org/wiki/2024_WazirX_hack), [CoinDesk](https://coindesk.com/business/2024/07/19/wazirx-liminal-custody-blame-each-other-as-230m-crypto-exploit-leaves-customers-stranded), [Halborn](https://www.halborn.com/blog/post/explained-the-wazirx-hack-july-2024)
- Address poisoning: [USENIX Security 2025, "Blockchain Address Poisoning"](https://www.usenix.org/conference/usenixsecurity25/presentation/tsuchiya), [arXiv 2501.16681](https://arxiv.org/abs/2501.16681v1)

**Systems the product must fit into**
- Safe Shield: [Guardian by Hypernative](https://help.safe.global/en/articles/470314-understanding-safe-shield-guardian-by-hypernative), [Safe x Hypernative announcement](https://safe.global/blog/safe-partners-with-hypernative-to-launch-enterprise-security-integration), [Blockaid and Tenderly in Safe{Wallet}](https://help.safe.global/en/articles/259531-safe-wallet-security-with-tenderly-blockaid)
- Chainlink CRE: [Introducing CRE](https://blog.chain.link/introducing-chainlink-runtime-environment), [CoinDesk, 4 Nov 2025](https://coindesk.com/web3/2025/11/04/chainlink-introduces-cre-to-fast-track-institutional-tokenization), [Functions deprecation](https://docs.chain.link/chainlink-functions/resources)
- ENSv2: [ENS Labs quarterly reports](https://discuss.ens.domains/t/ens-labs-quarterly-progress-reports/20565/7), [DAO activation request (secondary source)](https://www.kucoin.com/news/flash/ens-asks-dao-to-approve-ensv2-activation-on-ethereum-mainnet)
- Arkiv: [From Golem DB to Arkiv](https://arkiv.dev.golem.network/blog/from-golem-db-to-arkiv), [roadmap](https://arkiv.dev.golem.network/roadmap), [arkiv-op-node](https://github.com/Arkiv-Network/arkiv-op-node)
- ERC-7730 clear signing: [The Block](https://www.theblock.co/post/401001/ethereum-foundation-rolls-out-support-for-clear-signing-crypto-security-solution), [Sourcify launch post](https://docs.sourcify.dev/blog/clear-signing-launch/), [Ledger overview](https://developers.ledger.com/docs/clear-signing/overview)
- MetaMask Snaps: [Transaction insights](https://docs.metamask.io/snaps/features/transaction-insights/), [Entry points](https://docs.metamask.io/snaps/reference/exports/)

## Not verified (treat as open)

- **Final eligibility.** Only the organisers can confirm. The rule text is from the 19 Oct capture, matched by a 6 Nov web search of the live page.
- **Dashboard state:** which project name and track are registered, and that each teammate is on HexFence only. Pramaan's docs record only "registered in From Scratch".
- Whether Arkiv offers a Continuity track. ENS prize details beyond Pramaan's 5 Nov research.
- The prize payout date.
- ENSv2 mainnet activation (DAO vote outcome) and the Arkiv mainnet date.
- CRE pricing and DON access terms.
- Current grant programmes and deadlines (EF ESP, ENS, Safe, Chainlink, Arkiv/Golem, Gitcoin).
- The WazirX root cause (disputed between WazirX and Liminal).
- The 27.7K lines in `workflows/cre-monitor` were counted, not inspected.
- Calculations, not measurements: the evidence volume (47,694 × 30 days), Bloom filter sizes, bucket counts, and the 1-in-2³² fingerprint odds. The speed targets in [07](07_REAL_WORLD_INTEGRATION_AND_SCALE.md) are goals.
