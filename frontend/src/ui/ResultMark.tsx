import type { CSSProperties } from "react";
import { useFx } from "../fx/useFx";

interface ResultMarkProps {
  success: boolean;
  label: string;
  size?: number;
}

export function ResultMark({ success, label, size = 44 }: ResultMarkProps) {
  const ref = useFx<HTMLSpanElement>();
  return (
    <span
      key={String(success)}
      ref={ref}
      data-fx={success ? "check-draw" : "cross-draw"}
      aria-label={label}
      style={{ "--fx-size": `${size}px` } as CSSProperties}
    />
  );
}
