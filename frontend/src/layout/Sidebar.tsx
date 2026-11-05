import { NavLink } from "react-router";
import { useFx } from "../fx/useFx";
import { Icon, type IconName } from "../ui/Icon";
import "./Sidebar.css";

const LINKS: ReadonlyArray<{ to: string; label: string; icon: IconName; end?: boolean }> = [
  { to: "/", label: "Accueil", icon: "home", end: true },
  { to: "/review", label: "Review", icon: "review" },
  { to: "/nettoyage", label: "Nettoyage", icon: "clean" },
  { to: "/analyses", label: "Analyses", icon: "history" },
  { to: "/reglages", label: "Réglages", icon: "settings" },
];

export function Sidebar() {
  const nav = useFx<HTMLElement>();
  return (
    <aside className="sidebar">
      <NavLink to="/" className="sidebar__brand" aria-label="codeguard, accueil">
        <span className="sidebar__mark" aria-hidden="true" />
        codeguard
      </NavLink>
      <nav
        ref={nav}
        className="sidebar__nav"
        data-fx="hover-pill"
        aria-label="Navigation principale"
      >
        {LINKS.map((link) => (
          <NavLink key={link.to} to={link.to} end={link.end} className="sidebar__link">
            <Icon name={link.icon} />
            <span>{link.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
