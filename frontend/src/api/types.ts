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

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
