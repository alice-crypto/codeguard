import type { Severity } from "../api/types";
import { severityLabels } from "../lib/labels";
import { Badge } from "./Badge";

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge tone={severity}>{severityLabels[severity]}</Badge>;
}
