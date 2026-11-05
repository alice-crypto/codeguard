import type { Finding, Severity } from "../../api/types";
import { severityLabels } from "../../lib/labels";
import { countBySeverity } from "./findings";
import "./FindingFilters.css";

interface FindingFiltersProps {
  findings: readonly Finding[];
  active: Severity | null;
  onChange: (severity: Severity | null) => void;
}

export function FindingFilters({ findings, active, onChange }: FindingFiltersProps) {
  const entries: Array<[Severity | null, string, number]> = [
    [null, "Toutes", findings.length],
    ...[...countBySeverity(findings)].map(([severity, count]): [Severity, string, number] => [
      severity,
      severityLabels[severity],
      count,
    ]),
  ];
  return (
    <div className="finding-filters" role="group" aria-label="Filtrer par sévérité">
      {entries.map(([value, label, count]) => (
        <button
          key={label}
          type="button"
          className="finding-filter"
          aria-pressed={active === value}
          onClick={() => onChange(value)}
        >
          {label} <span className="finding-filter__count">{count}</span>
        </button>
      ))}
    </div>
  );
}
