export type CredentialSource = "session" | "env" | null;

export interface Credentials {
  anthropic: CredentialSource;
  github: CredentialSource;
}

export interface ServerStatus {
  version: string;
  credentials: Credentials;
  efforts: Effort[];
  severities: Severity[];
}

export interface ProjectConfig {
  model: string;
  effort: Effort;
  max_cost_usd: number;
  min_severity: Severity;
  checks: string[];
  formatters: string[];
}

export interface Project {
  root: string;
  name: string;
  branch: string;
  default_base: string | null;
  changed_files: number;
  github_repo: string | null;
  config_error: string | null;
  config?: ProjectConfig;
}

export type ReviewMode = "auto" | "staged" | "base" | "paths" | "pr";
export type CleanMode = "base" | "paths" | "pr";

export interface RunOptions {
  path: string | null;
  effort: Effort;
  max_cost: number;
  base?: string;
  paths?: string;
  pr?: number;
  repo?: string;
}

export interface ReviewRequest extends RunOptions {
  mode: ReviewMode;
  min_severity: Severity;
}

export interface CleanRequest extends RunOptions {
  mode: CleanMode;
  goal: string;
  run_checks: boolean;
  dry_run: boolean;
}

export type JobKind = "review" | "clean";
export type JobStatus = "running" | "done" | "failed" | "cancelled";

export interface JobSummary {
  id: string;
  kind: JobKind;
  label: string;
  status: JobStatus;
  created: number;
  finished: number | null;
  cancel_requested: boolean;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
}

export type FindingCategory =
  | "bug"
  | "security"
  | "performance"
  | "concurrency"
  | "maintainability"
  | "dead_code"
  | "tests"
  | "style";

export interface Finding {
  path: string;
  line: number;
  end_line: number;
  severity: Severity;
  category: FindingCategory;
  confidence: "high" | "medium" | "low";
  title: string;
  explanation: string;
  suggested_code: string;
}

export interface ReviewResult {
  target: string;
  summary: string;
  partial: boolean;
  findings: Finding[];
  dropped: string[];
  posted_url: string | null;
  model: string;
  usage: Usage;
  estimated_cost_usd: number | null;
}

export type CleanStatus =
  | "committed"
  | "dry_run"
  | "no_change"
  | "checks_failed"
  | "baseline_failed";

export type CleanChangeKind =
  | "dead_code"
  | "duplication"
  | "simplification"
  | "naming"
  | "comments"
  | "imports"
  | "other";

export interface CleanChange {
  path: string;
  kind: CleanChangeKind;
  description: string;
}

export interface CleanResult {
  target: string;
  status: CleanStatus;
  status_label: string;
  summary: string;
  partial: boolean;
  changes: CleanChange[];
  left_alone: string[];
  out_of_scope: string[];
  branch: string | null;
  commit: string | null;
  worktree: string | null;
  diff: string;
  checks_ran: boolean;
  checks_output: string;
  model: string;
  usage: Usage;
  estimated_cost_usd: number | null;
}

interface JobDetailBase extends JobSummary {
  error: string | null;
  logs: string[];
  log_count: number;
}

export interface ReviewJobDetail extends JobDetailBase {
  kind: "review";
  result: ReviewResult | null;
  can_post?: boolean;
  repo?: string | null;
}

export interface CleanJobDetail extends JobDetailBase {
  kind: "clean";
  result: CleanResult | null;
  pushed?: boolean;
  pull_request_url?: string | null;
  discarded?: boolean;
  github_repo?: string | null;
}

export type JobDetail = ReviewJobDetail | CleanJobDetail;

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
