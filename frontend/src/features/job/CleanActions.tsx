import { ApiError } from "../../api/client";
import { api } from "../../api/endpoints";
import { useJobAction } from "../../api/hooks";
import type { CleanJobDetail } from "../../api/types";
import { isSafeUrl } from "../../lib/safeUrl";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { useConfirm } from "../../ui/confirm";
import { useToast } from "../../ui/toast";
import "./CleanActions.css";

export function CleanActions({ job }: { job: CleanJobDetail }) {
  const confirm = useConfirm();
  const notify = useToast();
  const push = useJobAction<boolean>(job.id, (openPr) => api.pushClean(job.id, openPr));
  const discard = useJobAction<void>(job.id, () => api.discardClean(job.id));
  const result = job.result;
  if (!result?.branch && !job.discarded) return null;

  const branch = result?.branch ?? "";
  const committed = result?.status === "committed" && !job.discarded;
  const keptOnFailure = result?.status === "checks_failed" && !job.discarded;
  const busy = push.isPending || discard.isPending;
  const failure = push.error ?? discard.error;

  async function openPullRequest() {
    const accepted = await confirm({
      title: "Ouvrir une pull request ?",
      body: `La branche ${branch} sera poussée, puis une PR sera ouverte sur ${job.github_repo}.`,
      action: "Ouvrir la PR",
    });
    if (accepted) push.mutate(true, { onSuccess: () => notify("Pull request ouverte") });
  }

  async function pushBranch() {
    const accepted = await confirm({
      title: "Pousser la branche ?",
      body: `La branche ${branch} sera envoyée sur origin.`,
      action: "Pousser",
    });
    if (accepted) push.mutate(false, { onSuccess: () => notify("Branche poussée") });
  }

  async function abandon() {
    const accepted = await confirm({
      title: "Abandonner ce nettoyage ?",
      body: `La branche locale ${branch} sera supprimée. Ton répertoire de travail n'est pas touché.`,
      action: "Abandonner",
      danger: true,
    });
    if (accepted) discard.mutate(undefined, { onSuccess: () => notify("Nettoyage abandonné") });
  }

  return (
    <>
      {job.discarded && <Banner title="Nettoyage abandonné">La branche a été supprimée.</Banner>}
      {job.pull_request_url && (
        <Banner tone="success">
          Pull request ouverte
          {isSafeUrl(job.pull_request_url) && (
            <>
              {" : "}
              <a href={job.pull_request_url} target="_blank" rel="noopener noreferrer">
                la voir
              </a>
            </>
          )}
        </Banner>
      )}
      {job.pushed && !job.pull_request_url && (
        <Banner tone="success">Branche poussée : {branch}</Banner>
      )}
      {failure instanceof ApiError && <Banner tone="error">{failure.message}</Banner>}
      <div className="clean-actions">
        {committed && job.github_repo && !job.pull_request_url && (
          <Button variant="primary" disabled={busy} onClick={openPullRequest}>
            Ouvrir une PR
          </Button>
        )}
        {committed && !job.pushed && (
          <Button disabled={busy} onClick={pushBranch}>
            Pousser la branche
          </Button>
        )}
        {(committed || keptOnFailure) && !job.pushed && (
          <Button variant="danger" disabled={busy} onClick={abandon}>
            Abandonner
          </Button>
        )}
      </div>
    </>
  );
}
