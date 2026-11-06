# Sepolia deployment rehearsal (on a FORK, not the live chain)

Date: 2026-11-06. **This is not a live Sepolia deployment.** No transaction here exists on the real chain, and no
Etherscan link from this run is valid.

What was run: `anvil --fork-url <Sepolia>` on port 8555 (chain id 11155111, the real ENSv2 contracts), the three
freshly generated testnet-only keys funded **on the fork only** with `anvil_setBalance`, then the exact commands a live
run uses:

```
pnpm run doctor --network sepolia --parent pramaan-mumbai26         -> READY
pnpm pramaan deploy identities --network sepolia --parent pramaan-mumbai26 --yes --broadcast-negative
```

Result: complete = true; `pramaan-mumbai26.eth` registered with a UserRegistry proxy (VerifiableFactory), three
subnames (`vaultlab|mirroryield|permitmarket`), a PermissionedResolver and a PramaanTimelock (120 s) per app, roles
granted (timelock: `pramaan.record` only; guardian: `pramaan.revoked` only). Role-boundary tests (`--broadcast-negative`): 72 transactions across the proposer, guardian, timelock and owner roles and
19 different attempts. 63 attempts that must revert (for example the proposer or the guardian writing `pramaan.record`
directly) all reverted; 9 positive controls that must succeed (for example the guardian writing `pramaan.revoked`) all
succeeded; none of the 72 differed from its expectation. 21 setup transactions in total.

Real chain at the time of the run: the owner address held 0 ETH on Sepolia, so the live run has not happened.

To make it live: fund the three addresses printed by `pnpm run doctor --network sepolia` (see docs/FAUCETS.md), then run
the same two commands with `SEPOLIA_RPC_URL_A/_B` pointing at two different public Sepolia RPCs.
