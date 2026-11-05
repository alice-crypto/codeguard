import { Link } from "react-router";
import type { JobStatus, JobSummary } from "../../api/types";
import { Reveal } from "../../fx/Reveal";
import { formatTime } from "../../lib/format";
import { statusLabels } from "../../lib/labels";
import { Badge, type BadgeTone } from "../../ui/Badge";
import { Icon } from "../../ui/Icon";
import { LiveDot } from "../../ui/LiveDot";
import "./JobList.css";

const TONES: Record<Exclude<JobStatus, "running">, BadgeTone> = {
  done: "ok",
  failed: "critical",
  cancelled: "neutral",
};

function JobRow({ job }: { job: JobSummary }) {
  return (
    <Link className="job-row" to={`/analyses/${job.id}`}>
      <Icon name={job.kind === "clean" ? "clean" : "review"} />
      <span className="job-row__text">
        <span className="job-row__label">{job.label}</span>
        <span className="job-row__meta">
          {job.kind === "clean" ? "Nettoyage" : "Review"} · {formatTime(job.created)}
        </span>
      </span>
      {job.status === "running" ? (
        <LiveDot>En cours</LiveDot>
      ) : (
        <Badge tone={TONES[job.status]}>{statusLabels[job.status]}</Badge>
      )}
    </Link>
  );
}

export function JobList({ jobs }: { jobs: readonly JobSummary[] }) {
  return (
    <Reveal effect="rise-stagger" className="job-list">
      {jobs.map((job) => (
        <JobRow key={job.id} job={job} />
      ))}
    </Reveal>
  );
}
