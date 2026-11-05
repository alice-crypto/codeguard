import { getJson, postJson } from "./client";
import type {
  CleanRequest,
  Credentials,
  JobDetail,
  JobSummary,
  Project,
  ReviewRequest,
  ServerStatus,
} from "./types";

export const api = {
  status: () => getJson<ServerStatus>("/api/status"),
  saveSecrets: (secrets: { anthropic_key?: string; github_token?: string }) =>
    postJson<Credentials>("/api/secrets", secrets),
  openProject: (path: string) => postJson<Project>("/api/project", { path }),
  startReview: (request: ReviewRequest) => postJson<JobSummary>("/api/review", request),
  startClean: (request: CleanRequest) => postJson<JobSummary>("/api/clean", request),
  jobs: () => getJson<JobSummary[]>("/api/jobs"),
  job: (id: string) => getJson<JobDetail>(`/api/jobs/${id}`),
  cancelJob: (id: string) => postJson<JobSummary>(`/api/jobs/${id}/cancel`),
  publishReview: (id: string) => postJson<JobDetail>(`/api/jobs/${id}/post`),
  pushClean: (id: string, openPr: boolean) =>
    postJson<JobDetail>(`/api/jobs/${id}/push`, { open_pr: openPr }),
  discardClean: (id: string) => postJson<JobDetail>(`/api/jobs/${id}/discard`),
};

export type ExportFormat = "markdown" | "json" | "sarif";

export function exportUrl(id: string, format: ExportFormat): string {
  return `/api/jobs/${id}/export?format=${format}`;
}
