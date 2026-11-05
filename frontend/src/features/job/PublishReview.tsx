import { ApiError } from "../../api/client";
import { api } from "../../api/endpoints";
import { useJobAction } from "../../api/hooks";
import type { ReviewJobDetail } from "../../api/types";
import { plural } from "../../lib/format";
import { isSafeUrl } from "../../lib/safeUrl";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { useConfirm } from "../../ui/confirm";
import { useToast } from "../../ui/toast";

export function PublishReview({ job }: { job: ReviewJobDetail }) {
  const confirm = useConfirm();
  const notify = useToast();
  const publish = useJobAction<void>(job.id, () => api.publishReview(job.id));
  const result = job.result;
  if (!job.can_post || !result) return null;

  if (result.posted_url) {
    return (
      <Banner tone="success">
        Publié sur GitHub
        {isSafeUrl(result.posted_url) && (
          <>
            {" : "}
            <a href={result.posted_url} target="_blank" rel="noopener noreferrer">
              voir la review
            </a>
          </>
        )}
      </Banner>
    );
  }

  async function run() {
    const accepted = await confirm({
      title: "Publier sur la pull request ?",
      body: `${plural(result?.findings.length ?? 0, "remarque")} seront visibles par tous sur ${job.repo}. Les remarques déjà publiées ne sont pas répétées.`,
      action: "Publier",
    });
    if (accepted) publish.mutate(undefined, { onSuccess: () => notify("Review publiée") });
  }

  return (
    <>
      <Button variant="primary" disabled={publish.isPending} onClick={run}>
        {publish.isPending ? "Publication…" : "Publier sur la PR"}
      </Button>
      {publish.error instanceof ApiError && <Banner tone="error">{publish.error.message}</Banner>}
    </>
  );
}
