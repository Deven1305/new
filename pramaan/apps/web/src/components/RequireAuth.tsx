import { Navigate, Outlet, useLocation } from "react-router";
import { isApiError } from "../lib/api";
import { useMe } from "../lib/hooks";
import { ErrorPanel, Loading } from "./ui";

/** Gate for the developer pages: they need a session (SIWE cookie) or a pasted API token. */
export function RequireAuth() {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <Loading label="Checking your session…" />;
  if (me.isError) {
    if (isApiError(me.error) && me.error.kind === "unauthorized") {
      return <Navigate to="/signin" replace state={{ from: location.pathname + location.search }} />;
    }
    return <ErrorPanel error={me.error} onRetry={() => void me.refetch()} />;
  }
  return <Outlet />;
}
