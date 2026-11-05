import type { Finding, Severity } from "../../api/types";

export const SEVERITY_ORDER: readonly Severity[] = ["critical", "high", "medium", "low", "info"];

export function countBySeverity(findings: readonly Finding[]): Map<Severity, number> {
  const counts = new Map<Severity, number>();
  for (const severity of SEVERITY_ORDER) {
    const count = findings.filter((finding) => finding.severity === severity).length;
    if (count) counts.set(severity, count);
  }
  return counts;
}

export function filterFindings(findings: readonly Finding[], severity: Severity | null): Finding[] {
  return severity ? findings.filter((finding) => finding.severity === severity) : [...findings];
}

export function findingLocation(finding: Finding): string {
  return finding.end_line !== finding.line
    ? `${finding.path}:${finding.line}-${finding.end_line}`
    : `${finding.path}:${finding.line}`;
}
