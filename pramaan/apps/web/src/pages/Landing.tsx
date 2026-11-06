import { ArrowRight, Bell, ExternalLink, FlaskConical, Puzzle, ScanSearch, Send } from "lucide-react";
import { Link } from "react-router";
import { Card, Pill, Section } from "../components/ui";
import { DEMO_APPS } from "../lib/config";
import { useMe } from "../lib/hooks";

const PHASES = [
  { icon: FlaskConical, name: "PROVE", text: "Slither and Aderyn find candidates. Foundry exploit tests run in a network-less Docker sandbox. A fix is proposed and re-verified. Only a passing exploit counts as proof." },
  { icon: Send, name: "PUBLISH", text: "A canonical manifest is signed (DSSE), pinned, and queued through PramaanTimelock into the ENSv2 record pramaan.record = pramaan:v1:<tag>:<sha256>." },
  { icon: ScanSearch, name: "VERIFY", text: "The Chrome extension re-checks the site, contracts and wallet request itself, and explains them in English, हिन्दी and मराठी before you sign." },
  { icon: Bell, name: "WATCH", text: "A chain monitor and a Chainlink CRE workflow watch the timelock, resolver and proxies, and raise alerts (Telegram when configured)." },
];

const CROPS: { name: string; text: string }[] = [
  { name: "Censorship resistance", text: "Verification reads the ENS record and the manifest straight from public RPCs and mirrors. It works with our backend switched off." },
  { name: "Open source", text: "MIT licensed. Manifests are canonical JSON, signatures are DSSE; anyone can recompute the hashes." },
  { name: "Privacy", text: "The extension verifies locally and never sends your address to Pramaan. Pages on this dashboard that call the backend (Verify, Decode) send the URL or request you type, to the backend you configured." },
  { name: "Security", text: "Pramaan never says a site is safe: green means the listed checks passed. Anything it could not check stays grey. AI-written fixes are proposals that need human review." },
];

export function Landing() {
  const me = useMe();
  return (
    <div>
      <section className="mb-10 pt-4">
        <p className="text-sm font-medium text-ink-2">ETHGlobal Mumbai 2026</p>
        <h1 className="mt-1 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">Proven before you ship. Verified before you sign.</h1>
        <p className="mt-4 max-w-2xl text-lg text-ink-2">
          Pramaan gives Ethereum dapps reproducible security evidence and signed, ENS-anchored releases, then lets every user check the live website, the contracts and the wallet request in their own browser.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link to={me.isSuccess ? "/dashboard" : "/signin"} className="btn btn-primary">
            {me.isSuccess ? "Open the dashboard" : "Sign in to the dashboard"} <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <Link to="/verify" className="btn btn-secondary">
            Verify a site or decode a request
          </Link>
          <Link to="/demo" className="btn btn-ghost">
            4-minute demo guide
          </Link>
        </div>
      </section>

      <Section title="How it works">
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PHASES.map((p, i) => (
            <li key={p.name} className="card p-4">
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-lg bg-inset text-accent">
                  <p.icon size={18} aria-hidden="true" />
                </span>
                <h3 className="font-semibold tracking-wide">
                  <span className="text-muted">{i + 1}. </span>
                  {p.name}
                </h3>
              </div>
              <p className="mt-2 text-sm text-ink-2">{p.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Three demo dapps" description="Independent origins, manifests and ENS identities. They run locally once the demo stack is up.">
        <ul className="grid gap-3 md:grid-cols-3">
          {DEMO_APPS.map((a) => (
            <li key={a.id} className="card flex flex-col p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-lg font-semibold">{a.name}</h3>
                <Pill>{a.kind}</Pill>
              </div>
              <p className="mt-1 text-sm">{a.story}</p>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-ink-2">
                {a.shows.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <a className="link mt-3 inline-flex items-center gap-1 pt-1 text-sm" href={a.url} target="_blank" rel="noreferrer">
                {a.url} <ExternalLink size={13} aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">These links only work while the demo stack is running on your machine (see the demo guide).</p>
      </Section>

      <Section title="Install the extension" description="The extension is the part that protects you. It is not published to a store; load it unpacked.">
        <Card>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>
              Build it: <code className="kbd-cmd">pnpm build:extension</code> (writes <code>apps/extension/dist</code>).
            </li>
            <li>
              Open <code className="kbd-cmd">chrome://extensions</code> and switch on <strong>Developer mode</strong>.
            </li>
            <li>
              Click <strong>Load unpacked</strong> and choose the <code className="kbd-cmd">apps/extension/dist</code> folder.
            </li>
            <li>Pin Pramaan, then open one of the demo apps. The verdict window shows four rows: site, contract, action and privacy.</li>
          </ol>
          <p className="mt-3 flex items-start gap-2 text-sm text-ink-2">
            <Puzzle size={16} className="mt-0.5 flex-none" aria-hidden="true" />
            Grey means unknown or not checked and is never shown as passed.
          </p>
        </Card>
      </Section>

      <Section title="What works without us (CROPS)">
        <div className="grid gap-3 md:grid-cols-2">
          {CROPS.map((c) => (
            <Card key={c.name}>
              <h3 className="font-semibold">{c.name}</h3>
              <p className="mt-1 text-sm text-ink-2">{c.text}</p>
            </Card>
          ))}
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Card className="overflow-hidden !p-0">
            <div data-tone="good" className="tone-bar p-4">
              <h3 className="font-semibold">Works without the Pramaan backend</h3>
              <ul className="mt-1 list-disc pl-5 text-sm text-ink-2">
                <li>Release verification in the extension (ENS, manifest, signature, files, contracts)</li>
                <li>Wallet-request explanations in three languages</li>
                <li>Address-leak detection and blocking</li>
              </ul>
            </div>
          </Card>
          <Card className="overflow-hidden !p-0">
            <div data-tone="info" className="tone-bar p-4">
              <h3 className="font-semibold">Needs the backend (this dashboard)</h3>
              <ul className="mt-1 list-disc pl-5 text-sm text-ink-2">
                <li>Running and storing sandboxed analysis, findings and fixes</li>
                <li>Release registry, IPFS pinning and timelock helpers</li>
                <li>Monitoring, alerts and Telegram notifications</li>
              </ul>
            </div>
          </Card>
        </div>
      </Section>
    </div>
  );
}
