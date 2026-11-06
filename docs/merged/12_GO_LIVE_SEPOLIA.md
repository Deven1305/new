# 12. Put Pramaan's three demo apps live on Sepolia (code is done; you supply keys and hosting)

`pnpm --dir pramaan demo:sepolia` is now implemented. It was **tested end to end on a separate local fork** with the identical code path (`demo:rehearse`: all three apps verified, ports +100, its own folders, your running demo untouched). It has **not** been run on real Sepolia, because that needs funded keys and three hosts that only you can create.

## What it does (one command)
Deploys the demo contracts to Sepolia, registers three ENS names, deploys a resolver and a timelock per app, runs PROVE (if Docker + the sandbox image exist), builds the three apps **with their final public URLs baked in**, signs and queues one release per app, waits the real 120 s timelock delay once, executes the three releases, copies the manifest + signature into each app's `.well-known/`, then prints the three folders to upload and the verify command. Real waits: three ENS commit delays (~62 s each), one timelock wait (125 s), PROVE (~4 min): about 10 minutes.

Safety built in: Sepolia only (mainnet is refused); owner/proposer/guardian must be three different accounts; their keys are read from `.env` and are **never written to disk** (only the release-signing key is); it refuses to start if a key cannot pay for the run; the published apps use a keyless public RPC.

## Steps

**1. Three testnet keys (you).** They already exist in your original `Pramaan\pramaan\.env`; copy the three `*_PRIVATE_KEY` lines (and `SEPOLIA_RPC_URL_A/B`) into `pramaan\.env` in this folder (git-ignored). Or make new ones. Never use a wallet that holds real money.

**2. Fund them with free test ETH (you).** Addresses: owner `0x0014a00De55114ddc7d39a7Fa5432c9a86a17483`, proposer `0x1d669a00aed74f0C831b74de36b5f00F640631a4`, guardian `0xaaFB3eA518B5A6dA10e0f3C2668f9BC0A3bbdBba`. The real gas price on Sepolia is tiny, so the actual cost is far below the doctor's pessimistic budget; the script checks balances at twice the current gas price. Aim for 0.02+ on the owner and 0.005 on the others to be safe against a fee spike. Faucets: `pramaan/docs/FAUCETS.md` (pk910 needs only a browser tab). Check: `pnpm --dir pramaan run doctor --network sepolia --parent pramaan-mumbai26`.

**3. Create three static sites FIRST (you), because ENS binds each app to its exact origin.** Each app needs its own origin, so use three separate projects on Vercel, Netlify or Cloudflare Pages (GitHub Pages cannot: all of one account's project sites share one origin). Create three empty projects and note the three final `https://…` addresses, e.g. `https://pramaan-vaultlab-<you>.vercel.app`. No path, no trailing slash.

**4. Deploy on-chain and build (me / the script):**
```powershell
cd pramaan
pnpm demo:sepolia --origins vaultlab=https://<vaultlab-host>,mirroryield=https://<mirroryield-host>,permitmarket=https://<permitmarket-host>
```
(`--skip-prove` to skip the sandbox; `--broadcast-negative` to also mine the permission-boundary reverts, which costs a little gas.)

**5. Upload each printed folder UNCHANGED** (`pramaan\apps\demos\hosted-sepolia\<app>`) to its project. No minify or asset optimisation (changed bytes turn the verdict red). With the Vercel CLI: `npx vercel deploy pramaan/apps/demos/hosted-sepolia/vaultlab --prod` (it asks you to log in once). Keep `.well-known/` (the hidden folder must be uploaded) and do not add files.

**6. Verify from anywhere:**
```powershell
pnpm --dir pramaan pramaan verify https://<vaultlab-host> --chain 11155111=<rpcA>,<rpcB>
```
Expect `release: VERIFIED` and `files: verified (green)`. Then open the live site with the extension: Release verified. In the extension options use two independent Sepolia RPCs.

## Rollback and limits
- Re-running creates **new** ENS names and contracts; it never reuses old ones. Old names simply stay registered (test tokens, no value).
- If the run stops half-way (rare), nothing is hosted yet and nothing is lost: re-run with the same `--origins`.
- The release-signing key is `pramaan/.pramaan/demo-sepolia/release-key.pem`: keep it private.
- Live Sepolia still lacks: Telegram alerts, the CRE monitor simulation, a manual MetaMask run of the live apps.
- `demo:rehearse` repeats the whole flow locally whenever you want a dry run: `pnpm --dir pramaan demo:rehearse --skip-prove`.
