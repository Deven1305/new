import { Navigate, Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { Dashboard } from "./pages/Dashboard";
import { DemoGuide } from "./pages/DemoGuide";
import { FindingDetailPage } from "./pages/FindingDetail";
import { Landing } from "./pages/Landing";
import { NotFound } from "./pages/NotFound";
import { ProjectLayout } from "./pages/project/ProjectLayout";
import { AnalysisPage } from "./pages/project/Analysis";
import { FindingsPage } from "./pages/project/Findings";
import { MonitoringPage } from "./pages/project/Monitoring";
import { Overview } from "./pages/project/Overview";
import { ReleasesPage } from "./pages/project/Releases";
import { ReleaseDetailPage } from "./pages/ReleaseDetail";
import { Settings } from "./pages/Settings";
import { SignIn } from "./pages/SignIn";
import { VerifyPage } from "./pages/Verify";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="signin" element={<SignIn />} />
        <Route path="verify" element={<VerifyPage />} />
        <Route path="demo" element={<DemoGuide />} />
        <Route element={<RequireAuth />}>
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="settings" element={<Settings />} />
          <Route path="projects/:projectId" element={<ProjectLayout />}>
            <Route index element={<Overview />} />
            <Route path="analysis" element={<AnalysisPage />} />
            <Route path="findings" element={<FindingsPage />} />
            <Route path="releases" element={<ReleasesPage />} />
            <Route path="monitoring" element={<MonitoringPage />} />
          </Route>
          <Route path="findings/:findingId" element={<FindingDetailPage />} />
          <Route path="releases/:releaseId" element={<ReleaseDetailPage />} />
        </Route>
        <Route path="projects" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
