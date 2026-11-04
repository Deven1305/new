# Running the current local slice

From the repository root, with Node 22+ and pnpm installed:

```sh
pnpm install --frozen-lockfile
pnpm server
```

In a second terminal run `pnpm dev:web`. Open http://localhost:5173/verify and use the sample approval in the decoder. The backend defaults to http://127.0.0.1:8787; the web client defaults to http://localhost:8787. The sample is synthetic and needs no wallet or real assets. The backend implements `/v1/decode` and `/healthz`; `/readyz` returns 503 and unimplemented endpoints return 501. The dashboard, authentication, release API, worker and site verification API are not ready.

`pnpm typecheck` checks the workspace. `pnpm --filter @pramaan/web build` and `pnpm --filter @pramaan/extension build` build those components. The root `pnpm build` additionally requires demo state; the current `demo:up` generates the old format and cannot supply it. Do not treat the extension bundle as an end-to-end verified product. Full chain tests require Foundry; PROVE also requires the sandbox image and Docker. See the status document before trying deployment scripts.

The extension re-fetches resources to calculate hashes; Chrome's webRequest API does not provide those original response bodies to this implementation. A re-fetch can differ from bytes actually executed, so a matching fetched copy cannot prove what the browser ran. Main-world provider wrapping is not universal wallet enforcement and can be bypassed. See [Chrome's webRequest documentation](https://developer.chrome.com/docs/extensions/reference/api/webRequest). Browser E2E verification and the full release journey are still outstanding.
