import type { ReactNode } from "react";
import { useFx } from "../fx/useFx";
import { cx } from "../lib/cx";
import "./Card.css";

interface CardProps {
  title?: ReactNode;
  spotlight?: boolean;
  className?: string;
  children: ReactNode;
}

export function Card({ title, spotlight, className, children }: CardProps) {
  const ref = useFx<HTMLElement>();
  return (
    <section
      ref={ref}
      data-fx={spotlight ? "spotlight-card" : undefined}
      className={cx("card", className)}
    >
      {title && <h2 className="card__title">{title}</h2>}
      {children}
    </section>
  );
}
