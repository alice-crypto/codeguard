import type { ReactNode } from "react";
import { useFx } from "../fx/useFx";
import "./Disclosure.css";

interface DisclosureProps {
  summary: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function Disclosure({ summary, defaultOpen, children }: DisclosureProps) {
  const ref = useFx<HTMLDetailsElement>();
  return (
    <details ref={ref} className="disclosure" data-fx="accordion" open={defaultOpen}>
      <summary>{summary}</summary>
      <div className="disclosure__body">{children}</div>
    </details>
  );
}
