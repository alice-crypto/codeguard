import { useFx } from "../fx/useFx";
import { formatNumber } from "../lib/format";
import "./Stat.css";

function CountUp({ value }: { value: number }) {
  const ref = useFx<HTMLSpanElement>();
  return (
    <span ref={ref} data-fx="count-up" data-fx-to={value}>
      {formatNumber(value)}
    </span>
  );
}

interface StatProps {
  label: string;
  value: number | string;
}

export function Stat({ label, value }: StatProps) {
  return (
    <div className="stat">
      <span className="stat__value">
        {typeof value === "number" ? <CountUp key={value} value={value} /> : value}
      </span>
      <span className="stat__label">{label}</span>
    </div>
  );
}
