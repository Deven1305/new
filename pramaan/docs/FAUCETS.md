# Getting Sepolia test funds

Sepolia ETH and MockUSDC are **test tokens with no value**. Never send real ETH anywhere for them, never give anyone a
seed phrase, and never use a key that holds real funds. Faucet rules change often: if one refuses you, try the next.
Do not use scripts or bots to get around captchas or limits.

## 1. Which accounts need what

Create four fresh accounts (MetaMask → account menu → "Add account"): **Owner**, **Proposer**, **Guardian**, **Demo user**.

| Account | Pays for | Gas (measured on a Sepolia fork) | Ask the faucets for |
|---|---|---|---|
| Owner | parent name + UserRegistry, 3 × (timelock, resolver, 2 role grants, subname) | ≈ 2.3 M + 3 × 10.9 M ≈ 35 M gas | 0.15–0.3 ETH |
| Proposer | `queue` of each release (and `execute`, which anyone may call) | ≈ 0.4 M per release | 0.02–0.05 ETH |
| Guardian | `cancel` / revocation (only in an emergency or demo) | ≈ 0.25 M per action | 0.02–0.05 ETH |
| Demo user | the transactions you sign in the demo apps | small | 0.05 ETH |

Sepolia gas is usually far below 1 gwei, so real costs are tiny; the doctor budgets at max(1.5 × current price,
3 gwei) so a fee spike does not stop a deployment halfway (an interrupted deployment can be resumed: re-run the same command).

## 2. Faucets (pages checked on 2026-11-04)

| Faucet | Gives | Requirements / limits |
|---|---|---|
| [Google Cloud Web3 faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) | Sepolia ETH (amount shown after sign-in) | Google account sign-in; daily limit |
| [Alchemy](https://www.alchemy.com/faucets/ethereum-sepolia) | 0.1 ETH / 24 h | no Alchemy account needed, but the address must hold **≥ 0.001 ETH on Ethereum mainnet** and have some mainnet activity |
| [QuickNode](https://faucet.quicknode.com/ethereum/sepolia) | base drip (doubled if you post on X) | small **mainnet balance** required, bot check, one claim per 12 h per address |
| [Chainlink](https://faucets.chain.link/sepolia) | 0.5 ETH + 25 LINK | connect a wallet (MetaMask/WalletConnect/Coinbase Wallet) |
| [Infura / MetaMask](https://www.infura.io/faucet/sepolia) ([MetaMask docs](https://docs.metamask.io/developer-tools/faucet/)) | Sepolia ETH | Infura/MetaMask developer account sign-in; daily limit |
| [pk910 PoW faucet](https://sepolia-faucet.pk910.de/) | what your browser mines (slow but no account) | keep the tab open while it "mines"; no mainnet balance or login |

Fallbacks when everything is dry: ask a teammate to send test ETH from their account (owner → proposer/guardian), or ask
the hackathon's sponsor booths. Whatever you receive, keep the Owner account for deployments only.

## 3. MockUSDC for the ENS registration

ENSv2 on Sepolia charges registration in its test stablecoin **MockUSDC** `0x240b0316Df57887DBBE58b586508b19e633a14aa`
(6 decimals, listed at <https://docs.ens.domains/learn/deployments>). Its verified source (`MockERC20.sol`) has a
public `mint(address to, uint256 amount)`: anyone can mint test USDC to themselves. **You do not need to do anything** —
`pnpm pramaan deploy identities` mints exactly the registration price (≈ 8 MockUSDC per year for labels of 5+ characters,
160 for 4 characters; 3-character labels cost more and 2-character labels are invalid) and approves it to the ETHRegistrar.
To do it by hand: `cast send 0x240b0316Df57887DBBE58b586508b19e633a14aa "mint(address,uint256)" <owner> 8000021 --rpc-url $SEPOLIA_RPC_URL_A`
(this needs the owner key; keep it out of your shell history, e.g. with `--interactive`).

## 4. Checking balances

- `pnpm run doctor --network sepolia --parent <label>` — derives the three addresses from `.env`, shows each balance
  against the estimate, the MockUSDC price/balance and whether the parent label is free, and ends with `READY` or the exact
  next steps. (Plain `pnpm doctor` is pnpm's own command; use `pnpm run doctor`.)
- `cast balance <address> --ether --rpc-url https://sepolia.gateway.tenderly.co`
- `cast call 0x240b0316Df57887DBBE58b586508b19e633a14aa "balanceOf(address)(uint256)" <address> --rpc-url https://sepolia.gateway.tenderly.co`
- On Etherscan: `https://sepolia.etherscan.io/address/<address>`
