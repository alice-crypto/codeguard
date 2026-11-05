import type { CSSProperties } from "react";
import { useFx } from "../fx/useFx";

interface OrbProps {
  thinking?: boolean;
  size?: number;
}

export function Orb({ thinking, size = 40 }: OrbProps) {
  const ref = useFx<HTMLSpanElement>();
  return (
    <span
      ref={ref}
      data-fx="ai-orb"
      data-fx-state={thinking ? "thinking" : undefined}
      aria-hidden="true"
      style={{ "--fx-size": `${size}px` } as CSSProperties}
    />
  );
}
