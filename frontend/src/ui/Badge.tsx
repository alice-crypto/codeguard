import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import "./Badge.css";

export type BadgeTone =
  | "neutral"
  | "ok"
  | "accent"
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "info";

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={cx("badge", tone !== "neutral" && `badge--${tone}`)}>{children}</span>;
}
