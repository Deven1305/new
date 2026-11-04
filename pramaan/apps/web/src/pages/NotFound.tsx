import { Link } from "react-router";
import { EmptyState } from "../components/ui";

export function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      action={
        <Link to="/" className="btn btn-primary">
          Back to the start
        </Link>
      }
    >
      That address is not part of the Pramaan dashboard.
    </EmptyState>
  );
}
