import type { ReactNode } from "react";
import { useFx } from "./useFx";

interface RevealProps {
  /** fade-up : un bloc ; rise-stagger : les enfants directs, l'un après l'autre. */
  effect?: "fade-up" | "rise-stagger";
  className?: string;
  children: ReactNode;
}

export function Reveal({ effect = "fade-up", className, children }: RevealProps) {
  const ref = useFx<HTMLDivElement>();
  return (
    <div ref={ref} data-fx={effect} className={className}>
      {children}
    </div>
  );
}
