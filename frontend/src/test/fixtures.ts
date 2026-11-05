import type { Finding, JobSummary, Project, ServerStatus, Usage } from "../api/types";

export const status: ServerStatus = {
  version: "0.1.0",
  credentials: { anthropic: "env", github: null },
  efforts: ["low", "medium", "high", "xhigh", "max"],
  severities: ["critical", "high", "medium", "low", "info"],
};

export const project: Project = {
  root: "/depots/app",
  name: "app",
  branch: "feature/rapport",
  default_base: "origin/main",
  changed_files: 3,
  github_repo: "acme/app",
  config_error: null,
  config: {
    model: "claude-opus-5-5",
    effort: "high",
    max_cost_usd: 5,
    min_severity: "low",
    checks: ["pytest -q"],
    formatters: [],
  },
};

export const summary: JobSummary = {
  id: "abc123",
  kind: "review",
  label: "changements en cours",
  status: "done",
  created: 1_800_000_000,
  finished: 1_800_000_030,
  cancel_requested: false,
};

export const usage: Usage = {
  input_tokens: 1000,
  output_tokens: 200,
  cache_write_tokens: 0,
  cache_read_tokens: 500,
};

export const finding: Finding = {
  path: "src/app.py",
  line: 12,
  end_line: 12,
  severity: "high",
  category: "bug",
  confidence: "high",
  title: "Division par zéro",
  explanation: "average([]) lève ZeroDivisionError.",
  suggested_code: "return total / len(items) if items else 0",
};
