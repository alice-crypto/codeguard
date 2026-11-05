import { HashRouter, Route, Routes } from "react-router";
import { AppShell } from "./layout/AppShell";
import { CleanPage, ReviewPage } from "./pages/AnalysisPages";
import { HistoryPage } from "./pages/HistoryPage";
import { HomePage } from "./pages/HomePage";
import { JobPage } from "./pages/JobPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { SettingsPage } from "./pages/SettingsPage";

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="review" element={<ReviewPage />} />
          <Route path="nettoyage" element={<CleanPage />} />
          <Route path="analyses" element={<HistoryPage />} />
          <Route path="analyses/:id" element={<JobPage />} />
          <Route path="reglages" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
