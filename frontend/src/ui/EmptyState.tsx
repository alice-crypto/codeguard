import type { ReactNode } from "react";
import "./EmptyState.css";

interface EmptyStateProps {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, children, action }: EmptyStateProps) {
  return (
    <div className="empty">
      <h2 className="empty__title">{title}</h2>
      {children && <p className="empty__text">{children}</p>}
      {action}
    </div>
  );
}
