import { useState } from "react";
import type { ReviewJobDetail, Severity } from "../../api/types";
import { Reveal } from "../../fx/Reveal";
import { Banner } from "../../ui/Banner";
import { Card } from "../../ui/Card";
import { Prose } from "../../ui/Prose";
import { ResultMark } from "../../ui/ResultMark";
import { DroppedFindings } from "./DroppedFindings";
import { ExportLinks } from "./ExportLinks";
import { FindingCard } from "./FindingCard";
import { FindingFilters } from "./FindingFilters";
import { filterFindings } from "./findings";
import { PublishReview } from "./PublishReview";
import { UsageLine } from "./UsageLine";
import "./ReviewResultView.css";

const STAGGER_LIMIT = 12;

export function ReviewResultView({ job }: { job: ReviewJobDetail }) {
  const [filter, setFilter] = useState<Severity | null>(null);
  const result = job.result;
  if (!result) return null;
  const visible = filterFindings(result.findings, filter);
  const cards = visible.map((finding, index) => (
    <FindingCard key={`${finding.path}:${finding.line}:${index}`} finding={finding} />
  ));

  return (
    <div className="review-result">
      {result.partial && (
        <Banner tone="warning" title="Review incomplète">
          La limite de tours ou de budget a été atteinte avant la fin.
        </Banner>
      )}
      <Card>
        <div className="review-result__summary">
          {result.findings.length === 0 && <ResultMark success label="Aucune remarque" />}
          <Prose>{result.summary}</Prose>
        </div>
        <div className="review-result__actions">
          <PublishReview job={job} />
          <ExportLinks jobId={job.id} />
        </div>
      </Card>
      {result.findings.length > 0 && (
        <>
          <FindingFilters findings={result.findings} active={filter} onChange={setFilter} />
          {visible.length <= STAGGER_LIMIT ? (
            <Reveal key={filter ?? "toutes"} effect="rise-stagger" className="review-result__list">
              {cards}
            </Reveal>
          ) : (
            <div className="review-result__list">{cards}</div>
          )}
        </>
      )}
      <DroppedFindings items={result.dropped} />
      <UsageLine model={result.model} usage={result.usage} cost={result.estimated_cost_usd} />
    </div>
  );
}
