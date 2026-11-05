import { useFx } from "../fx/useFx";
import "./Skeleton.css";

export function Skeleton({ lines = 3, label = "Chargement" }: { lines?: number; label?: string }) {
  const ref = useFx<HTMLDivElement>();
  return (
    <div ref={ref} className="skeleton" role="status">
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className="skeleton__line" data-fx="shimmer" aria-hidden="true" />
      ))}
    </div>
  );
}
