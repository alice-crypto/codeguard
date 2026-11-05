import { Link } from "react-router";
import { useFx } from "../fx/useFx";
import { Icon, type IconName } from "../ui/Icon";
import "./HomeActions.css";

interface ActionProps {
  to: string;
  icon: IconName;
  title: string;
  text: string;
}

function Action({ to, icon, title, text }: ActionProps) {
  const ref = useFx<HTMLAnchorElement>();
  return (
    <Link ref={ref} to={to} className="home-action" data-fx="spotlight-card">
      <Icon name={icon} size={22} />
      <span className="home-action__title">{title}</span>
      <span className="home-action__text">{text}</span>
    </Link>
  );
}

export function HomeActions() {
  return (
    <div className="home-actions">
      <Action
        to="/review"
        icon="review"
        title="Lancer une review"
        text="Des changements, une branche, des fichiers ou une pull request."
      />
      <Action
        to="/nettoyage"
        icon="clean"
        title="Nettoyer du code"
        text="Code mort, duplications, complexité : sans changer le comportement."
      />
    </div>
  );
}
