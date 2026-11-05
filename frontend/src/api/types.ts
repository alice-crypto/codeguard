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

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
