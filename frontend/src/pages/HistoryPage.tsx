import { useJobs } from "../api/hooks";
import { JobList } from "../features/history/JobList";
import { Banner } from "../ui/Banner";
import { EmptyState } from "../ui/EmptyState";
import { LinkButton } from "../ui/LinkButton";
import { PageHeader } from "../ui/PageHeader";
import { Skeleton } from "../ui/Skeleton";
import "./pages.css";

export function HistoryPage() {
  const jobs = useJobs();
  return (
    <div className="page">
      <PageHeader
        title="Analyses"
        lead="Celles de cette session : l'historique est perdu à l'arrêt du serveur."
      />
      {jobs.isPending && <Skeleton lines={4} label="Chargement des analyses" />}
      {jobs.error && <Banner tone="error">{jobs.error.message}</Banner>}
      {jobs.data?.length === 0 && (
        <EmptyState
          title="Aucune analyse pour l'instant"
          action={
            <LinkButton to="/review" variant="primary">
              Lancer une review
            </LinkButton>
          }
        >
          Tes reviews et nettoyages apparaîtront ici, avec leur résultat.
        </EmptyState>
      )}
      {jobs.data && jobs.data.length > 0 && <JobList jobs={jobs.data} />}
    </div>
  );
}
