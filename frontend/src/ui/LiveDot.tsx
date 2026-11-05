import type { ReactNode } from "react";
import { useFx } from "../fx/useFx";
import "./LiveDot.css";

export function LiveDot({ children }: { children: ReactNode }) {
  const ref = useFx<HTMLSpanElement>();
  return (
    <span ref={ref} className="live-dot" data-fx="live-dot">
      {children}
    </span>
  );
}
