# Pramaan backend API contract (shared by apps/server and apps/web)

JSON; ids UUID; ISO times; camelCase. Errors: `{error:{code,message}}` (no stack traces). Cookie auth = httpOnly SameSite=Lax `pramaan_session`; every cookie-authenticated POST/PATCH/DELETE must send header `x-pramaan-csrf: <csrfToken>`. Bearer API tokens (`pat_…`) are CSRF-exempt.

## Health / config
- `GET /healthz` → `{ok:true}` · `GET /readyz` → `{ok, db, worker, docker:{available, image}}`
- `GET /v1/config` → `{telegram, ipfs, github, proposer, ai, cre}` booleans (UI disables unsupported actions with the reason)

## Auth
- `GET /v1/auth/nonce` → `{nonce}` · `POST /v1/auth/siwe {message, signature}` → cookie + `{user:{id,address,isAdmin}, csrfToken}`
- `POST /v1/auth/logout` · `GET /v1/me` → `{user, csrfToken}` (401 signed out)
- `GET/POST /v1/tokens`, `DELETE /v1/tokens/:id` (POST `{name, projectId?}` → `{id, token}` shown once). Dev: bootstrap admin token in `DATA_DIR/admin-token.txt`.

## Stats / projects
- `GET /v1/stats` → `{projects, jobs:{QUEUED,RUNNING,COMPLETED,FAILED,CANCELLED}, findings:{reproduced, fixedVerified, notReproduced, candidate, falsePositive}, releases:{active, queued}, alerts:{open, critical}}`
- `GET /v1/projects` → `[{id,name,slug,ensName,domain,repoUrl,chainId,isDemo,role,activeRelease:{id,tag,sha256,status}|null,counts:{findings,openAlerts}}]`
- `POST /v1/projects {name, ensName?, domain?, repoUrl?, chainId?, rpcUrl?}` · `GET /v1/projects/:id` → project + `{members, contracts, monitors}` · `PATCH /v1/projects/:id`

## Analysis jobs
- `POST /v1/projects/:id/uploads` (multipart `file`, .zip ≤ MAX_UPLOAD_MB) → `{uploadId, sha256, size}`
- `POST /v1/projects/:id/jobs {source:{type:"example",name:"contracts"|"reentrancy-bank"|"initializer-takeover"}|{type:"github",url,ref?}|{type:"upload",uploadId}, params:{fix?, ai?}, force?}` → `{job, deduplicated}`
- `GET /v1/projects/:id/jobs` · `GET /v1/jobs/:id` · `GET /v1/jobs/:id/events?after=<seq>` → `[{seq,step,status,message,createdAt}]`
- `GET /v1/jobs/:id/stream` — SSE: event `progress` `{seq,step,status,message,createdAt}`, event `status` `{status}`; honours Last-Event-ID; closes on terminal status · `POST /v1/jobs/:id/cancel`
- job = `{id, projectId, kind:"analyze"|"fix", status:"QUEUED"|"RUNNING"|"COMPLETED"|"FAILED"|"CANCELLED", source, params, commitSha, toolchainHash, attempts, error, result, createdAt, startedAt, finishedAt}`; analyze result = `{repo, commit, tools, build, scanners, regression, sandbox, counts:{candidates, reproduced, notReproduced, candidatesOnly, fixesVerified}, fixes, reportMarkdown}`

## Findings / fixes
- `GET /v1/projects/:id/findings?status=` · `GET /v1/findings/:id` → `{id, label, vulnClass, title, severity, confidence, status, contract, functionSig, file, lines, sources, templateId, plan, gates, vulnerableRun, review, exploitTest:{fileName, source, sha256}|null, evidence:[{sha256, createdAt}], fixes:[{id, generator, file, diff, explanation, status, verification}]}`
- `POST /v1/findings/:id/review {decision:"confirmed"|"false-positive", note?}` · `POST /v1/findings/:id/fix {ai?}` → `{job}` · `GET /v1/findings/:id/evidence/:sha256` · `POST /v1/fixes/:id/pull-request` → `{url}` (501 unless GITHUB_TOKEN + GitHub source; never merges)

## Releases
- `GET /v1/projects/:id/releases` · `POST /v1/projects/:id/releases {manifest, signature?, signerSpki?}` (server canonicalizes, hashes, verifies DSSE; invalid → 400)
- `GET /v1/releases/:id` → release + `{manifest}` · `GET /v1/releases/:id/manifest` (canonical bytes) · `POST /v1/releases/:id/refresh | /ipfs | /queue | /execute` (501 when not configured)
- release = `{id, projectId, tag, sha256, pointer, cid, signatureStatus:"verified"|"invalid"|"unsigned", storage, timelockOpId, eta, queueTx, executeTx, status:"draft"|"signed"|"queued"|"active"|"superseded"|"cancelled"|"revoked", createdAt}`
- `GET /v1/mirror/:sha256` → manifest bytes (public, cacheable)

## Public tools
- `POST /v1/verify/site {url}` → verifier-core result · `POST /v1/decode {method, params, chainId?, origin?}` → decoder result (both public, rate limited)

## Monitoring
- `GET/POST /v1/projects/:id/monitors` (`{kind:"timelock"|"resolver"|"registry"|"proxy"|"upgrade-timelock", address, chainId?, rpcUrl?, label?}`) · `GET /v1/projects/:id/events?limit=` · `GET /v1/projects/:id/alerts?status=open|acked` · `POST /v1/alerts/:id/ack` · `POST /v1/projects/:id/alerts/test-telegram`
- `POST /v1/ingest/cre` — header `x-pramaan-signature: sha256=<hex HMAC-SHA256(CRE_INGEST_SECRET, raw body)>`; body `{workflow, runId, observedAt, chainId, app, ensName, decision, severity, details, idempotencyKey}`; observedAt older than 10 min or in the future → 400
- `POST /v1/webhooks/github` — `X-Hub-Signature-256` with GITHUB_WEBHOOK_SECRET; push → analyze job (idempotent by delivery id)
