import type { Effort, Project, RunOptions } from "../../api/types";

export type TargetMode = "auto" | "staged" | "base" | "paths" | "pr";

export interface TargetValues {
  mode: TargetMode;
  base: string;
  paths: string;
  pr: string;
  repo: string;
  effort: Effort;
  maxCost: string;
}

export function initialTarget(mode: TargetMode, project: Project | null): TargetValues {
  return {
    mode,
    base: "",
    paths: "",
    pr: "",
    repo: "",
    effort: project?.config?.effort ?? "high",
    maxCost: String(project?.config?.max_cost_usd ?? 5),
  };
}

export function buildOptions(values: TargetValues, project: Project | null): RunOptions {
  const options: RunOptions = {
    path: project?.root ?? null,
    effort: values.effort,
    max_cost: Number(values.maxCost),
  };
  if (values.mode === "base") {
    options.base = values.base.trim() || (project?.default_base ?? "");
  }
  if (values.mode === "paths") {
    options.paths = values.paths;
  }
  if (values.mode === "pr") {
    options.pr = Number(values.pr);
    options.repo = values.repo.trim() || (project?.github_repo ?? "");
  }
  return options;
}

export function validateTarget(values: TargetValues): string | null {
  if (values.mode === "paths" && !values.paths.trim()) {
    return "Indique au moins un fichier ou un dossier.";
  }
  if (values.mode === "pr" && !/^[1-9]\d*$/.test(values.pr.trim())) {
    return "Indique le numéro de la pull request.";
  }
  const cost = Number(values.maxCost);
  if (!Number.isFinite(cost) || cost <= 0) {
    return "Le budget doit être un montant positif.";
  }
  return null;
}
