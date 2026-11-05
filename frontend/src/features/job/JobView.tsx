import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { ApiError } from "../../api/client";
import { queryKeys, useJob } from "../../api/hooks";
import { Reveal } from "../../fx/Reveal";
import { formatDuration, formatTime } from "../../lib/format";
import { statusLabels } from "../../lib/labels";
import { Banner } from "../../ui/Banner";
import { LinkButton } from "../../ui/LinkButton";
import { PageHeader } from "../../ui/PageHeader";
import { ReadingProgress } from "../../ui/ReadingProgress";
import { Skeleton } from "../../ui/Skeleton";
import { ActivityLog } from "./ActivityLog";
import { CleanResultView } from "./CleanResultView";
import { ReviewResultView } from "./ReviewResultView";
import { RunningPanel } from "./RunningPanel";
import "./JobView.css";

export function JobView({ id }: { id: string }) {
  const { data: job, error, isPending } = useJob(id);
  const client = useQueryClient();
  const status = job?.status;

  useEffect(() => {
    if (status && status !== "running") {
      void client.invalidateQueries({ queryKey: queryKeys.jobs, exact: true });
    }
  }, [status, client]);

  if (isPending) return <Skeleton lines={6} label="Chargement de l'analyse" />;
  if (!job) {
    return (
      <Banner tone="error" title="Analyse indisponible">
        {error instanceof ApiError && error.status === 404
          ? "Elle n'existe plus : l'historique est perdu à l'arrêt du serveur."
          : (error?.message ?? "Erreur inconnue")}
      </Banner>
    );
  }

  const kind = job.kind === "clean" ? "Nettoyage" : "Review";
  const duration = job.finished ? ` · ${formatDuration(job.finished - job.created)}` : "";

  return (
    <div className="job-view">
      {job.status === "done" && <ReadingProgress />}
      <PageHeader
        title={`${kind} : ${job.label}`}
        lead={`${statusLabels[job.status]} · lancée à ${formatTime(job.created)}${duration}`}
        actions={
          job.status !== "running" && (
            <LinkButton to={job.kind === "clean" ? "/nettoyage" : "/review"}>
              Nouvelle analyse
            </LinkButton>
          )
        }
      />
      {job.status === "running" && <RunningPanel job={job} />}
      {job.status === "failed" && (
        <Banner tone="error" title="L'analyse a échoué">
          {job.error}
        </Banner>
      )}
      {job.status === "cancelled" && (
        <Banner tone="warning" title="Analyse arrêtée">
          Aucun résultat n'a été conservé.
        </Banner>
      )}
      {job.status === "done" && (
        <Reveal>
          {job.kind === "review" ? <ReviewResultView job={job} /> : <CleanResultView job={job} />}
        </Reveal>
      )}
      <ActivityLog logs={job.logs} open={job.status === "running"} />
    </div>
  );
}
