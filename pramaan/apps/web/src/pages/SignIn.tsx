import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Wallet } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { Btn, Card, ErrorPanel, Field, Notice, PageHeader, Spinner } from "../components/ui";
import { api, authStore } from "../lib/client";
import { discoverWallets, signInWithWallet, WalletError, type DiscoveredWallet } from "../lib/siwe";
import { useMe } from "../lib/hooks";
import type { MeResponse } from "../lib/types";

export function SignIn() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/dashboard";

  const [wallets, setWallets] = useState<DiscoveredWallet[] | null>(null);
  const [walletBusy, setWalletBusy] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<unknown>(null);
  const [token, setToken] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenError, setTokenError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    void discoverWallets().then((w) => live && setWallets(w));
    return () => {
      live = false;
    };
  }, []);

  if (me.isSuccess) return <Navigate to={from} replace />;

  async function connect(w: DiscoveredWallet) {
    setWalletBusy(w.id);
    setWalletError(null);
    try {
      authStore.setBearer(null);
      const res = await signInWithWallet(api, w);
      authStore.setCsrf(res.csrfToken);
      qc.clear();
      navigate(from, { replace: true });
    } catch (err) {
      setWalletError(err);
    } finally {
      setWalletBusy(null);
    }
  }

  async function submitToken(e: FormEvent) {
    e.preventDefault();
    const value = token.trim();
    if (!value) return;
    setTokenBusy(true);
    setTokenError(null);
    authStore.setBearer(value);
    try {
      const res = await api.get<MeResponse>("/v1/me");
      authStore.setCsrf(res.csrfToken ?? null);
      qc.clear();
      navigate(from, { replace: true });
    } catch (err) {
      authStore.setBearer(null);
      setTokenError(err);
    } finally {
      setTokenBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Sign in" subtitle="The dashboard is for the people who build and publish a dapp. Verifying a website needs no account." />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Wallet size={18} aria-hidden="true" /> Sign in with Ethereum
          </h2>
          <p className="mt-1 text-sm text-ink-2">Your wallet signs a plain-text EIP-4361 message that names this site and a one-time nonce. Nothing is sent on-chain and no funds can move.</p>
          <div className="mt-3 space-y-2">
            {wallets === null ? (
              <Spinner label="Looking for wallets…" />
            ) : wallets.length === 0 ? (
              <Notice tone="warning" title="No browser wallet found">
                Install or unlock an EIP-1193 wallet extension and reload, or use an API token instead.
              </Notice>
            ) : (
              wallets.map((w) => (
                <Btn key={w.id} variant="secondary" className="w-full !justify-start" busy={walletBusy === w.id} disabled={walletBusy !== null} onClick={() => void connect(w)}>
                  {w.icon ? <img src={w.icon} alt="" width={20} height={20} className="rounded" /> : <Wallet size={16} aria-hidden="true" />}
                  <span className="truncate">{w.name}</span>
                </Btn>
              ))
            )}
          </div>
          {walletError ? (
            <div className="mt-3">
              {walletError instanceof WalletError ? <Notice tone={walletError.rejected ? "unknown" : "critical"} title={walletError.rejected ? "Request declined" : "Wallet problem"}>{walletError.message}</Notice> : <ErrorPanel error={walletError} />}
            </div>
          ) : null}
        </Card>

        <Card>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <KeyRound size={18} aria-hidden="true" /> Use an API token
          </h2>
          <p className="mt-1 text-sm text-ink-2">
            Paste a <code>pat_…</code> token. It stays in this tab&apos;s sessionStorage only and is cleared when you sign out or close the tab. For local development the backend writes a bootstrap admin token to{" "}
            <code className="kbd-cmd">DATA_DIR/admin-token.txt</code> (default <code>.pramaan/server/admin-token.txt</code>).
          </p>
          <form onSubmit={(e) => void submitToken(e)} className="mt-3 space-y-3">
            <Field label="API token" htmlFor="api-token">
              <input id="api-token" className="field font-mono" type="password" autoComplete="off" spellCheck={false} placeholder="pat_…" value={token} onChange={(e) => setToken(e.target.value)} />
            </Field>
            <Btn type="submit" variant="primary" busy={tokenBusy} disabled={!token.trim()}>
              Continue with token
            </Btn>
          </form>
          {tokenError ? (
            <div className="mt-3">
              <ErrorPanel error={tokenError} />
            </div>
          ) : null}
        </Card>
      </div>
      {me.isError && me.error && (me.error as { kind?: string }).kind === "unreachable" ? (
        <div className="mt-4">
          <ErrorPanel error={me.error} onRetry={() => void me.refetch()} />
        </div>
      ) : null}
    </div>
  );
}
