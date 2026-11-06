# 07. Real-world use: fitting into today's systems, and scaling

## 1. Who uses it, and for what

| User | Job to be done | HexFence part |
|---|---|---|
| Safe owners: DAOs, company treasuries, exchange and custody wallets | "Never pay a lookalike; never sign a delegatecall from a tampered UI" | Guard (on-chain), Pay / Safe App, CRE alerts |
| dApp teams | "Prove our fix, publish a release users can check, and get warned if anything changes" | Pramaan layer: PROVE, PUBLISH, monitor, console |
| Everyday wallet users | "Tell me in my language what I'm signing, and whether this is the real site" | Extension, MetaMask Snap |
| AI agents that sign | "Same check as a person, as a tool call" | `@hexfence/check`, MCP `hexfence_check` |
| Wallets and security vendors | "Open poisoning data and a standard release format to consume" | Arkiv evidence feed, release records, snapshot files |
| Victims and investigators (India) | "What happened, and a report I can file" | Explorer Losses tab, rescue pack |

## 2. Integration with current systems

| System | How HexFence plugs in | Status | Constraint to respect |
|---|---|---|---|
| **Safe transaction guard** | `setGuard(<HexFenceGuard>)` through Transaction Builder, one call per transaction | v1 live on Sepolia (Safe 1.4.1) | **A Safe holds one transaction guard at a time** |
| Safe module guard (1.5.0) | `HexFenceModuleGuard` covers module transactions | Deployed; no live Safe uses it | Module transactions bypass transaction guards without it |
| Safe Apps | HexFence Pay runs inside Safe{Wallet} | Built; not tried by a person | Needs a person-run test, then a listing request |
| **Safe Shield** (Hypernative Guardian guard + Blockaid/Tenderly scanning) | Coexist rather than compete: (a) a **composite guard** that runs HexFence's rule next to another guard; (b) offer HexFence's open evidence and lookalike rule as a feed vendors can consume | Guardian is installed as a transaction guard; its removal needs a signed transaction plus a 24-hour timelock (Safe help centre) | The one-guard rule makes (a) a must for Guardian users |
| **MetaMask Snaps** | A HexFence Snap uses `onTransaction` (permission `endowment:transaction-insight`) to show the five rows; `severity: "critical"` forces a warning the user must dismiss | Not built | A Snap **warns but cannot block**, and cannot hash page files. It sees the origin only with `allowTransactionOrigin` |
| Other browser wallets (Rabby, Rainbow…) | The extension wraps every EIP-6963 provider | Pramaan extension tested on a fork | Page code can grab a provider first (stated limit) |
| **ERC-7730 clear signing** | The decoder reads descriptors from the release record and from the public registry; `hexfence publish` submits the app's descriptors | Pramaan decoder supports ERC-7730; HexFence Pay has a paste panel | The EF took over stewardship on 12 May 2026; clearsigning.org is the registry; contracts must be verified on Sourcify first |
| Sourcify | Every contract in a release is verified; the record keeps the match status | HexFence contracts: exact match | Needed for ERC-7730 registry submissions too |
| **ENS** | `hexfence.*` text records hold the active release, domain, signer, timelock and revocations | Fork-tested only | ENSv1 text records work on mainnet today. ENSv2 Permissioned Resolvers need ENSv2 live on mainnet |
| **Arkiv** | Evidence, losses, releases, alerts and snapshots | Rabdi testnet (chain 7794095) | No mainnet date found. Keep it behind an interface, with signed mirror files as a fallback |
| **Chainlink CRE** | Two workflows (sentinel, monitor) on a DON | WASM builds; no simulation yet | CRE has been live on mainnet since Nov 2025. Do not build on Chainlink Functions (mainnet service ends 30 Jun 2026) |
| GitHub Actions | Release workflow: build → hashes → sign (keyless) → queue in the timelock → index on Arkiv | Templates exist in both repos (`pages.yml`, `pramaan-release.yml`) | Attestations prove provenance, not secure code |
| IPFS + ENS contenthash | Content-addressed hosting for releases | Optional path in Pramaan | Removes the "different bytes for the re-fetch" problem |
| Alerts | Telegram today; webhooks (Slack, Discord, PagerDuty) through the console | Telegram code exists, disabled | Alerts are advisory; the Guard never reads them |
| AI agents | MCP stdio server, offline SDK | Built (offline only) | Add live Guard and evidence reads behind the same privacy rules |
| India reporting | The rescue pack is formatted for the National Cyber Crime Helpline (1930) and cybercrime.gov.in; issuer contacts (Tether, Circle) are already in the README | Pack exists | A pack is a lead, not proof |

## 3. Dependencies and fallbacks

| Dependency | If it is late or down | Fallback |
|---|---|---|
| ENSv2 mainnet (an ENS Labs report said testnet beta in May 2026, mainnet as a "fast follow"; the DAO activation vote was not confirmed) | Releases cannot use Permissioned Resolvers on mainnet | ENSv1 text records plus the HexFence timelock as the only writer |
| Arkiv mainnet (date not found) | No production evidence store | Signed snapshot and bucket files on Pages/IPFS; Arkiv stays the index when ready |
| Anon-RPC / Nox (Sepolia today) | Reads go direct | A labelled direct route ("not anonymous"), never a silent fallback |
| CRE DON access | No decentralised watcher | Run the same workflow in simulation mode and say so; the Guard does not depend on it |
| A wallet's Snap or ERC-7730 support | Fewer surfaces | The extension and Safe App keep working |

## 4. How it scales

### 4.1 Evidence: from 173 records to millions

- One 7,200-block run (about 24 hours) found **47,694** suspected pairs. With 30-day expiry that is up to **~1.43 million** live records (an upper bound, since duplicates share an `evidenceId`).
- Today's clients bulk-read all 173 records. That keeps the checked address private, but a browser cannot bulk-read a million records.

The design, which keeps the privacy property:

1. **Daily Bloom filter of lookalike addresses** (`@hexfence/check` already has a Bloom filter):

   | Records (n) | False-positive rate | Size | Hash functions |
   |---|---|---|---|
   | 1.43M | 1% | ~1.7 MB | 7 |
   | 1.43M | 0.1% | ~2.6 MB | 10 |

   Formula: bits per record = −ln(p) / (ln 2)². One download per day, cached, with its SHA-256 published in `hexfence.snapshot.v1`.
2. **A Bloom hit is not a verdict.** The client then downloads one **prefix bucket**: records grouped by the first 16 bits of the address hash, 65,536 buckets of about 22 records each. The host learns only which 1-in-65,536 bucket was read, and through Nox not the reader's IP. This is the range-query idea Have I Been Pwned uses for passwords.
3. **Static, signed files.** Buckets live on Pages, IPFS or a CDN; their hashes are listed in the snapshot entity. Any mirror works.
4. **Arkiv write budget.** Write full entities only for records that matter (involving protected Safes, losses, a fair sample), and the snapshot entity daily. The complete set travels as files.

### 4.2 Detector

- More chains: Ethereum, then BSC (the USENIX study measured both), then the big L2s (Base, Arbitrum, Optimism, Polygon).
- Own archive node or a paid log API with range splitting; incremental cursors; the existing idempotent writes.
- More publishers: anyone can run the detector and publish under their own key, and clients show how many publishers agree (C3 exists).

### 4.3 Release checks

- A record lists at most 5,000 files (schema limit). Hash in the browser and cache by record hash.
- Batch ENS reads through the Universal Resolver. Two-RPC agreement doubles reads, so cache per block.
- Records are found by hash, so CDNs and mirrors scale reads for free.

### 4.4 Watchers and console

- CRE: one configuration per tenant (Safes, apps), topic-filtered log triggers, batched reads per run. Check CRE pricing before promising volumes.
- Console: the Postgres job queue feeds horizontally scaled sandbox workers. PROVE jobs are CPU-heavy (Foundry), so use per-account quotas.

### 4.5 Speed targets (goals, not measurements)

| Step | Target |
|---|---|
| Pre-sign check, warm caches | p95 under 1.5 s |
| First check of a new app | under 5 s |
| Nox route | warm at browser start (today 26–38 s cold on hosted Pay) |

## 5. India-first details

- **Languages:** English, Hindi and Marathi exist with a missing-translation test. Add Tamil, Telugu, Bengali and Gujarati only with native-speaker review (the H10 method).
- **Exchanges and custodians:** the WazirX loss (Jul 2024) shows why treasury multisigs need on-chain refusal and an upgrade watch.
- **Victims:** the rescue pack supports reports to 1930 and cybercrime.gov.in and to token issuers.
- **Law:** HexFence never holds funds or keys. Ask a lawyer what applies before selling hosted services in India (data protection under the DPDP Act, 2023, and any VASP rules).

## 6. How it can pay for itself

| Free and open (public good, CROPS) | Paid |
|---|---|
| Guards, extension, Snap, explorer, detector, the evidence feed and snapshot files | Hosted PROVE and the release pipeline for dApp teams (console) |
| Release format, ENS keys and Arkiv schemas as open specs | Monitoring and alert SLAs for treasuries, exchanges and custodians |
| MCP tool and offline SDK | Enterprise policy: no override, three RPCs, private dashboards, install support |

Grants for the public-good parts are in [08](08_ROADMAP_AND_WINNING_PATH.md).

## 7. What to measure

| Metric | Why |
|---|---|
| Safes with a HexFence Guard; value protected | Real adoption |
| Lookalike payments refused on-chain | The core outcome |
| Releases published; apps verified per day | Developer adoption |
| Alerts delivered before a change took effect | The WATCH promise |
| **Human-labelled detector precision** | Trust in the evidence (start with the H9 method, larger samples) |
| False red rate reported by users | Usability; a security tool that cries wolf gets uninstalled |
