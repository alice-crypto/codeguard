import type { Finding } from "../../api/types";
import { categoryLabels } from "../../lib/labels";
import { Badge } from "../../ui/Badge";
import { CodeBlock } from "../../ui/CodeBlock";
import { Prose } from "../../ui/Prose";
import { SeverityBadge } from "../../ui/SeverityBadge";
import { findingLocation } from "./findings";
import "./FindingCard.css";

export function FindingCard({ finding }: { finding: Finding }) {
  return (
    <article className={`finding finding--${finding.severity}`}>
      <div className="finding__meta">
        <SeverityBadge severity={finding.severity} />
        <Badge>{categoryLabels[finding.category]}</Badge>
        {finding.confidence === "low" && <Badge tone="medium">À vérifier</Badge>}
        <span className="finding__location">{findingLocation(finding)}</span>
      </div>
      <h3 className="finding__title">{finding.title}</h3>
      <Prose>{finding.explanation}</Prose>
      {finding.suggested_code && <CodeBlock code={finding.suggested_code} />}
    </article>
  );
}
