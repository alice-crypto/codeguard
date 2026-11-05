import { useJobs, useServerStatus } from "../../api/hooks";
import { Button } from "../../ui/Button";
import "./RunButton.css";

interface RunButtonProps {
  label: string;
  maxCost: string;
  needsProject: boolean;
  pending: boolean;
  reassurance: string;
}

export function RunButton({ label, maxCost, needsProject, pending, reassurance }: RunButtonProps) {
  const jobs = useJobs();
  const status = useServerStatus();
  const running = jobs.data?.some((job) => job.status === "running") ?? false;
  const cost = Number(maxCost);
  const budget = cost > 0 ? ` · ${cost} $ max` : "";

  let hint = reassurance;
  if (running) hint = "Une analyse est déjà en cours.";
  else if (needsProject) hint = "Ouvre d'abord un projet.";
  else if (status.data && !status.data.credentials.anthropic) {
    hint = "Aucune clé Claude détectée : ajoute-la dans les réglages.";
  }

  return (
    <div className="run-button">
      <Button type="submit" variant="primary" disabled={running || needsProject || pending}>
        {label}
        {budget}
      </Button>
      <p className="run-button__hint">{hint}</p>
    </div>
  );
}
