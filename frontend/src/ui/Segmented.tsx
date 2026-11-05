import type { ReactNode } from "react";
import { useFx } from "../fx/useFx";
import "./Segmented.css";

export interface Segment<T extends string> {
  value: T;
  label: ReactNode;
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<Segment<T>>;
  onChange: (value: T) => void;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  const ref = useFx<HTMLDivElement>();
  return (
    <div ref={ref} className="segmented" data-fx="tab-slider" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
