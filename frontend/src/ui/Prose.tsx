import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import "./Prose.css";

export function Prose({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cx("prose", className)}>{children}</p>;
}
