import { useRef } from "react";
import { Outlet } from "react-router";
import { Sidebar } from "./Sidebar";
import { useRouteFocus } from "./useRouteFocus";
import "./AppShell.css";

export function AppShell() {
  const main = useRef<HTMLElement>(null);
  useRouteFocus(main);
  return (
    <div className="app-shell">
      <a className="app-shell__skip" href="#contenu">
        Aller au contenu
      </a>
      <Sidebar />
      <main ref={main} id="contenu" className="app-shell__main" tabIndex={-1}>
        <div className="app-shell__content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
