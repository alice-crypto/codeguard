import type { ReactNode } from "react";
import { usePageTitle } from "./usePageTitle";
import "./PageHeader.css";

interface PageHeaderProps {
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, lead, actions }: PageHeaderProps) {
  usePageTitle(typeof title === "string" ? title : undefined);
  return (
    <header className="page-header">
      <div>
        <h1 className="page-header__title">{title}</h1>
        {lead && <p className="page-header__lead">{lead}</p>}
      </div>
      {actions}
    </header>
  );
}
