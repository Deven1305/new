import { Link } from "react-router";
import { Card, PageHeader } from "../components/ui";

export function DemoGuide() {
  return (
    <div className="space-y-6">
      <PageHeader title="Demo guide" subtitle="Explore release integrity and signing risks using local test assets." />
      <Card>
        <h2>Current status</h2>
        <p>The local demo orchestration is being integrated. See RUN.md for the verified startup commands and current limitations.</p>
        <p>Findings are candidates until reproduced. Matching a release does not certify a contract as safe.</p>
        <Link to="/verify">Open the verification tools</Link>
      </Card>
    </div>
  );
}
