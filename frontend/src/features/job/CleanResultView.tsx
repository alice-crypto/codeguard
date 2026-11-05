import type { CleanJobDetail } from "../../api/types";
import { Banner } from "../../ui/Banner";
import { Card } from "../../ui/Card";
import { CodeBlock } from "../../ui/CodeBlock";
import { Prose } from "../../ui/Prose";
import { ResultMark } from "../../ui/ResultMark";
import { BranchCommands } from "./BranchCommands";
import { CleanActions } from "./CleanActions";
import { ChangeList, LeftAloneList } from "./CleanSummaryLists";
import { DiffViewer } from "./DiffViewer";
import { UsageLine } from "./UsageLine";
import "./CleanResultView.css";

export function CleanResultView({ job }: { job: CleanJobDetail }) {
  const result = job.result;
  if (!result) return null;
  const failed = result.status === "checks_failed" || result.status === "baseline_failed";
  const committed = result.status === "committed" && !job.discarded;

  return (
    <div className="clean-result">
      <Card>
        <div className="clean-result__status">
          <ResultMark success={!failed} label={result.status_label} />
          <div>
            <h2 className="clean-result__title">{result.status_label}</h2>
            {result.summary && <Prose>{result.summary}</Prose>}
          </div>
        </div>
        <CleanActions job={job} />
      </Card>
      {result.partial && (
        <Banner tone="warning" title="Nettoyage incomplet">
          La limite de tours ou de budget a été atteinte avant la fin.
        </Banner>
      )}
      {committed && !result.checks_ran && (
        <Banner tone="warning" title="Aucune vérification exécutée">
          Rien ne garantit que le comportement est préservé : relis le diff avant de fusionner.
        </Banner>
      )}
      {result.out_of_scope.length > 0 && (
        <Banner tone="warning" title="Fichiers modifiés hors périmètre, par un formateur">
          {result.out_of_scope.join(", ")}
        </Banner>
      )}
      {failed && result.checks_output && (
        <section className="clean-result__section">
          <h2 className="clean-result__title">Sortie des vérifications</h2>
          <pre className="clean-result__output" tabIndex={0}>
            {result.checks_output}
          </pre>
        </section>
      )}
      {result.worktree && !job.discarded && (
        <section className="clean-result__section">
          <h2 className="clean-result__title">Worktree conservé pour inspection</h2>
          <CodeBlock code={result.worktree} />
        </section>
      )}
      {committed && result.branch && <BranchCommands branch={result.branch} />}
      <ChangeList changes={result.changes} />
      <LeftAloneList items={result.left_alone} />
      {result.diff && (
        <section className="clean-result__section">
          <h2 className="clean-result__title">Diff</h2>
          <DiffViewer diff={result.diff} />
        </section>
      )}
      {result.model && (
        <UsageLine model={result.model} usage={result.usage} cost={result.estimated_cost_usd} />
      )}
    </div>
  );
}
