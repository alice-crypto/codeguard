import { Outlet } from "react-router";
import { Sidebar } from "./Sidebar";
import "./AppShell.css";

export function AppShell() {
  return (
    <div className="app-shell">
      <a className="app-shell__skip" href="#contenu">
        Aller au contenu
      </a>
      <Sidebar />
      <main id="contenu" className="app-shell__main" tabIndex={-1}>
        <div className="app-shell__content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
