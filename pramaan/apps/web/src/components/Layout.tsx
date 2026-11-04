import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Moon, ShieldCheck, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { api, authStore } from "../lib/client";
import { API_BASE_URL } from "../lib/config";
import { shortAddress } from "../lib/format";
import { useAuthMode, useMe, useReadiness } from "../lib/hooks";
import { applyTheme, effectiveTheme, saveTheme, storedTheme, type ThemeChoice } from "../lib/theme";
import { isApiError } from "../lib/api";
import { Btn, cx } from "./ui";

function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeChoice>(() => effectiveTheme());
  useEffect(() => {
    applyTheme(storedTheme());
  }, []);
  const next: ThemeChoice = theme === "dark" ? "light" : "dark";
  return (
    <Btn
      variant="ghost"
      size="sm"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => {
        saveTheme(next);
        setTheme(next);
      }}
    >
      {theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
    </Btn>
  );
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  cx("rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap", isActive ? "bg-inset text-ink" : "text-ink-2 hover:bg-hover hover:text-ink");

function Account() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const mode = useAuthMode();
  const [busy, setBusy] = useState(false);
  if (me.isPending) return <span className="text-xs text-muted">…</span>;
  if (me.isError) {
    if (isApiError(me.error) && me.error.kind === "unauthorized") {
      return (
        <Link to="/signin" className="btn btn-primary btn-sm">
          Sign in
        </Link>
      );
    }
    return (
      <span className="text-xs text-muted" title={me.error.message}>
        Backend offline
      </span>
    );
  }
  const user = me.data.user;
  const label = user.address ? shortAddress(user.address) : (user.displayName ?? (mode === "token" ? "API token" : "Signed in"));
  return (
    <div className="flex items-center gap-1.5">
      <Link to="/settings" className="max-w-[9rem] truncate rounded-md px-2 py-1 text-sm font-medium text-ink-2 hover:bg-hover" title={user.address ?? label}>
        {label}
        {user.isAdmin ? <span className="ml-1.5 rounded bg-inset px-1 text-[0.6875rem] text-ink-2">admin</span> : null}
      </Link>
      <Btn
        variant="ghost"
        size="sm"
        busy={busy}
        aria-label="Sign out"
        title="Sign out"
        onClick={() => {
          setBusy(true);
          const finish = () => {
            authStore.setBearer(null);
            authStore.setCsrf(null);
            qc.clear();
            setBusy(false);
            navigate("/");
          };
          if (mode === "token") {
            finish();
            return;
          }
          api.post("/v1/auth/logout").catch(() => undefined).finally(finish);
        }}
      >
        <LogOut size={16} aria-hidden="true" />
      </Btn>
    </div>
  );
}

function BackendStatus() {
  const ready = useReadiness();
  const state = ready.isPending ? "checking" : ready.isError ? "offline" : ready.data.ok ? "ready" : "degraded";
  const text = {
    checking: "Checking backend…",
    offline: "Backend unreachable",
    ready: "Backend ready",
    degraded: "Backend degraded",
  }[state];
  const docker = ready.data?.docker;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="inline-block size-2 rounded-full" style={{ background: state === "ready" ? "var(--good)" : state === "offline" ? "var(--critical)" : state === "degraded" ? "var(--warning)" : "var(--unknown)" }} />
      <span>{text}</span>
      {docker && !docker.available ? <span className="text-muted">· Docker sandbox unavailable</span> : null}
    </span>
  );
}

export function Layout() {
  const location = useLocation();
  const me = useMe();
  const signedIn = me.isSuccess;
  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, [location.pathname]);
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <ShieldCheck size={20} className="text-accent" aria-hidden="true" />
            Pramaan
          </Link>
          <nav aria-label="Main" className="order-last -mx-1 flex w-full gap-1 overflow-x-auto pb-1 sm:order-none sm:mx-0 sm:w-auto sm:flex-1 sm:pb-0 sm:pl-4">
            {signedIn ? (
              <NavLink to="/dashboard" className={navClass}>
                Dashboard
              </NavLink>
            ) : null}
            <NavLink to="/verify" className={navClass}>
              Verify
            </NavLink>
            <NavLink to="/demo" className={navClass}>
              Demo guide
            </NavLink>
            <NavLink to="/" end className={navClass}>
              About
            </NavLink>
          </nav>
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <Account />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-line px-4 py-4 text-xs text-ink-2">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
          <span>Proven before you ship. Verified before you sign.</span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <BackendStatus />
            <code className="text-muted">{API_BASE_URL}</code>
          </span>
        </div>
      </footer>
    </div>
  );
}
