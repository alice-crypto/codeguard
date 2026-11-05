import { useCancelJob } from "../../api/hooks";
import type { JobDetail } from "../../api/types";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { Icon } from "../../ui/Icon";
import { LiveDot } from "../../ui/LiveDot";
import { LoadingBar } from "../../ui/LoadingBar";
import { Orb } from "../../ui/Orb";
import "./RunningPanel.css";

export function RunningPanel({ job }: { job: JobDetail }) {
  const cancel = useCancelJob(job.id);
  return (
    <Card>
      <div className="running-panel">
        <Orb thinking size={52} />
        <div className="running-panel__text">
          <LiveDot>En cours</LiveDot>
          <p>L'agent lit le code et vérifie ce qu'il avance. Tu peux quitter cette page.</p>
        </div>
        <Button
          disabled={job.cancel_requested || cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          <Icon name="stop" size={16} />
          {job.cancel_requested ? "Arrêt demandé…" : "Arrêter"}
        </Button>
      </div>
      <LoadingBar label="Analyse en cours" />
      {job.cancel_requested && (
        <Banner tone="warning">L'agent s'arrêtera à la fin de la requête en cours.</Banner>
      )}
    </Card>
  );
}
