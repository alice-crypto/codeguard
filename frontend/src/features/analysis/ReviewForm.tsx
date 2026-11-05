import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { ApiError } from "../../api/client";
import { useStartReview } from "../../api/hooks";
import type { ReviewMode, Severity } from "../../api/types";
import { severityLabels } from "../../lib/labels";
import { Banner } from "../../ui/Banner";
import { ChoiceList, type Choice } from "../../ui/ChoiceList";
import { Field } from "../../ui/Field";
import { Select } from "../../ui/inputs";
import { useProject } from "../project/ProjectProvider";
import { buildOptions, initialTarget, validateTarget, type TargetValues } from "./formValues";
import { RunButton } from "./RunButton";
import { RunSettings } from "./RunSettings";
import { TargetFields } from "./TargetFields";
import "./AnalysisForm.css";

const TARGETS: ReadonlyArray<Choice<ReviewMode>> = [
  {
    value: "auto",
    label: "Changements en cours",
    hint: "Les modifications non commitées, sinon la branche par rapport à la base.",
  },
  { value: "staged", label: "Changements indexés", hint: "Ce qui partira au prochain commit." },
  { value: "base", label: "Branche", hint: "Tout ce qui diffère d'une référence." },
  { value: "paths", label: "Audit de fichiers", hint: "Les fichiers tels quels, sans diff." },
  { value: "pr", label: "Pull request GitHub", hint: "Lue sur GitHub, sans exécuter son code." },
];

const SEVERITIES = Object.keys(severityLabels) as Severity[];

export function ReviewForm() {
  const { project } = useProject();
  const navigate = useNavigate();
  const start = useStartReview();
  const [values, setValues] = useState<TargetValues>(() => initialTarget("auto", project));
  const [minSeverity, setMinSeverity] = useState<Severity>(project?.config?.min_severity ?? "low");
  const [invalid, setInvalid] = useState<string | null>(null);
  const update = (patch: Partial<TargetValues>) => setValues((old) => ({ ...old, ...patch }));

  function submit(event: FormEvent) {
    event.preventDefault();
    const problem = validateTarget(values);
    setInvalid(problem);
    if (problem) return;
    start.mutate(
      {
        ...buildOptions(values, project),
        mode: values.mode as ReviewMode,
        min_severity: minSeverity,
      },
      { onSuccess: (job) => navigate(`/analyses/${job.id}`) },
    );
  }

  const failure = invalid ?? (start.error instanceof ApiError ? start.error.message : null);

  return (
    <form className="analysis-form" onSubmit={submit} noValidate>
      <ChoiceList
        legend="Que veux-tu relire ?"
        value={values.mode as ReviewMode}
        options={TARGETS}
        onChange={(mode) => update({ mode })}
      />
      <TargetFields values={values} project={project} onChange={update} />
      <RunSettings values={values} onChange={update}>
        <Field label="Sévérité minimale">
          {(control) => (
            <Select
              {...control}
              value={minSeverity}
              onChange={(event) => setMinSeverity(event.target.value as Severity)}
            >
              {SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {severityLabels[severity]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </RunSettings>
      {failure && <Banner tone="error">{failure}</Banner>}
      <RunButton
        label="Lancer la review"
        maxCost={values.maxCost}
        needsProject={!project && values.mode !== "pr"}
        pending={start.isPending}
        reassurance="Rien n'est publié sans ta confirmation."
      />
    </form>
  );
}
