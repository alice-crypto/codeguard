import type {
  CleanChangeKind,
  Effort,
  FindingCategory,
  JobStatus,
  Severity,
} from "../api/types";

export const severityLabels: Record<Severity, string> = {
  critical: "Critique",
  high: "Élevée",
  medium: "Moyenne",
  low: "Faible",
  info: "Info",
};

export const categoryLabels: Record<FindingCategory, string> = {
  bug: "Bug",
  security: "Sécurité",
  performance: "Performance",
  concurrency: "Concurrence",
  maintainability: "Maintenabilité",
  dead_code: "Code mort",
  tests: "Tests",
  style: "Style",
};

export const changeKindLabels: Record<CleanChangeKind, string> = {
  dead_code: "Code mort",
  duplication: "Duplication",
  simplification: "Simplification",
  naming: "Nommage",
  comments: "Commentaires",
  imports: "Imports",
  other: "Autre",
};

export const effortLabels: Record<Effort, string> = {
  low: "Faible",
  medium: "Moyen",
  high: "Élevé",
  xhigh: "Très élevé",
  max: "Maximal",
};

export const statusLabels: Record<JobStatus, string> = {
  running: "En cours",
  done: "Terminée",
  failed: "En échec",
  cancelled: "Arrêtée",
};
