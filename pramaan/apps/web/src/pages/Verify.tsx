import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { encodeFunctionData, maxUint256, parseAbi } from "viem";
import { VerdictView } from "../components/VerdictView";
import { Btn, Card, ErrorPanel, Field, Notice, PageHeader, Pill, Section, Tabs, ToneChip, ToneIcon } from "../components/ui";
import { api } from "../lib/client";
import { LANGS, normalizeDecode, normalizeSiteVerdict, type DecodeView, type Lang } from "../lib/verdict";

const METHODS = ["eth_sendTransaction", "eth_signTypedData_v4", "personal_sign", "eth_sign", "wallet_sendCalls", "eth_signTypedData_v3", "eth_signTypedData"] as const;

/** A sample input (not a result): an unlimited ERC-20 approval, so the decoder has something to explain. */
export function sampleApprovalParams(): unknown[] {
  const data = encodeFunctionData({ abi: parseAbi(["function approve(address spender, uint256 amount)"]), functionName: "approve", args: ["0x3333333333333333333333333333333333333333", maxUint256] });
  return [{ from: "0x1111111111111111111111111111111111111111", to: "0x2222222222222222222222222222222222222222", data, value: "0x0" }];
}

function SiteVerifier() {
  const [url, setUrl] = useState("");
  const verify = useMutation({ mutationFn: (u: string) => api.post<unknown>("/v1/verify/site", { url: u }) });
  const view = verify.data !== undefined ? normalizeSiteVerdict(verify.data) : null;
  return (
    <Section title="Check a website" description="Reads the site's ENS release record and manifest and compares them. The backend does this for you here; the extension does the same locally and also watches the page while you use it.">
      <Card>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            verify.mutate(url.trim());
          }}
        >
          <div className="flex-1">
            <Field label="Website address" htmlFor="verify-url">
              <input id="verify-url" className="field" type="url" inputMode="url" placeholder="http://localhost:5180" value={url} onChange={(e) => setUrl(e.target.value)} required />
            </Field>
          </div>
          <Btn type="submit" variant="primary" busy={verify.isPending} disabled={!url.trim()}>
            Verify
          </Btn>
        </form>
      </Card>
      <div className="mt-4" aria-live="polite">
        {verify.isError ? <ErrorPanel error={verify.error} /> : null}
        {view ? <VerdictView view={view} /> : null}
      </div>
    </Section>
  );
}

function DecodeResult({ view }: { view: DecodeView }) {
  const available = LANGS.filter((l) => view.explanations[l.id]);
  const [lang, setLang] = useState<Lang>(view.explanations.en ? "en" : (available[0]?.id ?? "en"));
  const ex = view.explanations[lang];
  return (
    <div className="space-y-3">
      <div className="tone-wash tone-bar rounded-lg px-4 py-3" data-tone={view.tone} role="status">
        <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
          <span className="tone-ink">
            <ToneIcon tone={view.tone} size={20} />
          </span>
          {view.levelLabel}
          {view.actionKind ? <Pill>{view.actionKind}</Pill> : null}
        </p>
        <p className="mt-0.5 text-sm text-ink-2">
          {view.interpreted
            ? "The risk level is the decoder's assessment of this request. A low level is not a promise that the request is safe."
            : "The decoder could not confidently interpret this request. That is shown as unknown, never as safe."}
        </p>
      </div>

      <Tabs
        label="Explanation language"
        value={lang}
        onChange={setLang}
        tabs={LANGS.map((l) => ({ id: l.id, label: l.native, lang: l.id }))}
      />
      <div role="tabpanel" id={`panel-${lang}`} aria-labelledby={`tab-${lang}`} lang={lang}>
        {ex ? (
          <Card className="space-y-2">
            <p className="text-base font-semibold">{ex.headline}</p>
            {ex.details.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {ex.details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            ) : null}
            {ex.risks.length > 0 ? (
              <ul className="space-y-1.5 text-sm">
                {ex.risks.map((r, i) => (
                  <li key={i} className="flex flex-wrap items-start gap-2">
                    <ToneChip tone={r.tone}>{r.level}</ToneChip>
                    <span className="min-w-0 flex-1 break-words">{r.text}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ) : (
          <Notice tone="unknown" title="No text in this language">
            The backend response contained no {LANGS.find((l) => l.id === lang)?.label} explanation.
          </Notice>
        )}
      </div>

      {view.findings.length > 0 ? (
        <Card>
          <h3 className="mb-1 font-semibold">Risk findings</h3>
          <ul className="space-y-1.5 text-sm">
            {view.findings.map((f, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <ToneChip tone={f.tone}>{f.level}</ToneChip>
                <code>{f.code}</code>
                {Object.entries(f.params).map(([k, v]) => (
                  <span key={k} className="text-xs text-ink-2 break-all">
                    {k}: {v}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {view.target ? (
        <p className="text-sm text-ink-2">
          Target: <code className="break-all">{view.target}</code>
        </p>
      ) : null}
      <details>
        <summary className="cursor-pointer text-sm text-ink-2">Decoded action (raw)</summary>
        <pre className="code-block mt-1 max-h-72 overflow-auto p-3 text-xs">{JSON.stringify(view.action, null, 2)}</pre>
      </details>
    </div>
  );
}

function DecodeTool() {
  const [method, setMethod] = useState<string>(METHODS[0]);
  const [params, setParams] = useState("");
  const [chainId, setChainId] = useState("11155111");
  const [origin, setOrigin] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const decode = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<unknown>("/v1/decode", body),
  });
  const view = decode.data !== undefined ? normalizeDecode(decode.data) : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(params);
    } catch {
      setLocalError("The params are not valid JSON.");
      return;
    }
    if (!Array.isArray(parsed)) {
      setLocalError("The params must be a JSON array, exactly as the wallet receives them.");
      return;
    }
    decode.mutate({ method, params: parsed, ...(chainId.trim() ? { chainId: Number(chainId) } : {}), ...(origin.trim() ? { origin: origin.trim() } : {}) });
  }

  return (
    <Section title="Decode a wallet request" description="Paste the params of a wallet request and read what it would do, in plain language. Nothing is sent to your wallet.">
      <Card>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
          <Field label="Method" htmlFor="dec-method">
            <select id="dec-method" className="field" value={method} onChange={(e) => setMethod(e.target.value)}>
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Chain id" htmlFor="dec-chain">
            <input id="dec-chain" className="field" inputMode="numeric" pattern="[0-9]*" value={chainId} onChange={(e) => setChainId(e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Params (JSON array)" htmlFor="dec-params" hint="For example [{ &quot;from&quot;: &quot;0x…&quot;, &quot;to&quot;: &quot;0x…&quot;, &quot;data&quot;: &quot;0x…&quot; }]">
              <textarea id="dec-params" className="field" rows={7} value={params} onChange={(e) => setParams(e.target.value)} spellCheck={false} required />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Page origin (optional)" htmlFor="dec-origin" hint="Used to check sign-in messages against the page that asked.">
              <input id="dec-origin" className="field" type="url" value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="https://app.example.com" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Btn type="submit" variant="primary" busy={decode.isPending} disabled={!params.trim()}>
              Decode
            </Btn>
            <Btn
              variant="ghost"
              onClick={() => {
                setMethod("eth_sendTransaction");
                setParams(JSON.stringify(sampleApprovalParams(), null, 2));
              }}
            >
              Fill a sample input (unlimited approval)
            </Btn>
          </div>
        </form>
        {localError ? (
          <div className="mt-3">
            <Notice tone="critical" title={localError} />
          </div>
        ) : null}
      </Card>
      <div className="mt-4" aria-live="polite">
        {decode.isError ? <ErrorPanel error={decode.error} /> : null}
        {view ? <DecodeResult key={JSON.stringify(Object.keys(view.explanations)) + String(view.method) + String(decode.submittedAt)} view={view} /> : null}
      </div>
    </Section>
  );
}

export function VerifyPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Verify before you sign" subtitle="Public tools. No account needed. Grey means unknown or not checked and is never counted as a pass." />
      <SiteVerifier />
      <DecodeTool />
    </div>
  );
}
