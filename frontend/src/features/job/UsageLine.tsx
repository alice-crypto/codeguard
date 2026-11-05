import type { Usage } from "../../api/types";
import { formatCost, formatNumber } from "../../lib/format";
import "./UsageLine.css";

interface UsageLineProps {
  model: string;
  usage: Usage;
  cost: number | null;
}

export function UsageLine({ model, usage, cost }: UsageLineProps) {
  const input = usage.input_tokens + usage.cache_read_tokens + usage.cache_write_tokens;
  return (
    <p className="usage-line">
      {model} · {formatNumber(input)} jetons en entrée, {formatNumber(usage.output_tokens)} en
      sortie · {formatCost(cost)} (estimation)
    </p>
  );
}
