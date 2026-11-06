# HexFence + Pramaan: merged codebase (index)

This folder is the merged project. **HexFence** (recipient firewall: Safe Guard + Arkiv evidence) is the host. **Pramaan** (release proof: PROVE, PUBLISH, VERIFY, WATCH) sits inside it, complete, in `pramaan/`, with its full git history.

> Honest provenance: `pramaan/` is pre-event work (base commit `6d30220`, 5 Nov 01:01 IST, before hacking began 5 Nov 21:00 IST). HexFence starts at `dc6e0c6` (6 Nov 01:19 IST). The ETHGlobal Classic rules make a merged entry ineligible for Finalist and from-scratch partner prizes (see `docs/planning/final_hexfence/02_RULES_AND_ELIGIBILITY.md`). Do not submit this as Classic work.

## Layout

```
hexfence_merged/
  contracts/            HexFence Guard v1, Guard V2, Module guard, Alerts consumer (Hardhat, Node 22)
  packages/shared       fingerprint, Safe decoder, verdicts (the on-chain Guard's rules in TypeScript)
  packages/check        offline check SDK + evidence Bloom filter
  packages/mcp          MCP server: tool `hexfence_check` (for AI agents)
  packages/arkiv        Arkiv schema, readers, writer
  packages/ui           shared UI bits
  packages/core   NEW   one verdict model: CheckRow, combine(), adapters for both projects
  integration/    NEW   merged-check: HexFence recipient row + Pramaan action row -> one verdict
  apps/detector         finds address-poisoning on mainnet, publishes to Arkiv
  apps/explorer         evidence browser (Evidence, Losses, Campaigns, Check my address)
  apps/pay              HexFence Pay: check and send a Safe payment, Guard setup
  apps/site             landing page + guided demo
  apps/extension        HexFence Chrome extension (reviews Safe payments on app.safe.global)
  sentinel/             Chainlink CRE workflow: dust / lookalike transfers to protected Safes
  pramaan/              the whole Pramaan project (its own pnpm workspace, untouched)
    packages/           decoder, engine (PROVE), manifest, release, verifier-core
    apps/               cli, extension (Chrome MV3), server, web (dashboard), demos (3 dApps)
    contracts/          Foundry: demo contracts + PramaanTimelock
    workflows/          Chainlink CRE monitor
    docker/, examples/, tools/, docs/
  docs/                 HexFence docs + planning/ + merged/ (this folder)
```

Pramaan stays its own workspace on purpose: it pins different tool versions (vitest 3, Foundry), and moving its packages is the multi-week "phase 2" of `docs/planning/final_hexfence/05_MERGE_STEPS.md`. The two are joined where it matters: `packages/core` + `integration/`.

## Read in this order

| File | Question it answers |
|---|---|
| [01_RUN.md](01_RUN.md) | How do I install, build, test and run it? |
| [02_DEPLOY.md](02_DEPLOY.md) | How do I put it on Sepolia / the web? |
| [03_TOOLS.md](03_TOOLS.md) | What does every tool do and how do I use it? |
| [04_AGENT_USE.md](04_AGENT_USE.md) | How does an AI agent use it? |
| [05_PRAMAAN_DEMOS.md](05_PRAMAAN_DEMOS.md) | Which of Pramaan's 3 demo apps do I show, and how do I know Pramaan works? |
| [06_EXTENSIONS_AND_WEBSITE.md](06_EXTENSIONS_AND_WEBSITE.md) | How do I use it as a Chrome extension or a website? |
| [07_SCREENS_EXPLAINED.md](07_SCREENS_EXPLAINED.md) | What does each screen / colour / row mean? |
| [08_VERIFICATION_REPORT.md](08_VERIFICATION_REPORT.md) | What was actually run here, and what was not? |

## One-minute proof that the merge works

```bash
pnpm install
pnpm merged:check
```

Five scenarios run HexFence's lookalike rule and Pramaan's decoder together. A transfer to a lookalike of an approved payee is RED, an unlimited approval is RED, a new supplier is AMBER, an approved payee is GREEN.
