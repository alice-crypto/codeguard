import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { ApiError } from "../../api/client";
import { useStartClean } from "../../api/hooks";
import type { CleanMode } from "../../api/types";
import { Banner } from "../../ui/Banner";
import { ChoiceList, type Choice } from "../../ui/ChoiceList";
import { useConfirm } from "../../ui/confirm";
import { Field } from "../../ui/Field";
import { TextInput } from "../../ui/inputs";
import { useProject } from "../project/ProjectProvider";
import { CleanOptions } from "./CleanOptions";
import { buildOptions, initialTarget, validateTarget, type TargetValues } from "./formValues";
import { RunButton } from "./RunButton";
import { RunSettings } from "./RunSettings";
import { TargetFields } from "./TargetFields";
import "./AnalysisForm.css";

const TARGETS: ReadonlyArray<Choice<CleanMode>> = [
  { value: "base", label: "Fichiers modifiés", hint: "Tout ce qui a changé depuis une référence." },
  { value: "paths", label: "Fichiers ou dossiers précis", hint: "Pour viser une zone du code." },
  { value: "pr", label: "Fichiers d'une pull request", hint: "Nécessite un clone local du dépôt." },
];

export function CleanForm() {
  const { project } = useProject();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const start = useStartClean();
  const [values, setValues] = useState<TargetValues>(() => initialTarget("base", project));
  const [goal, setGoal] = useState("");
  const [runChecks, setRunChecks] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(null);
  const update = (patch: Partial<TargetValues>) => setValues((old) => ({ ...old, ...patch }));
  const checks = project?.config?.checks ?? [];

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = validateTarget(values);
    setInvalid(problem);
    if (problem) return;
    const willRun = runChecks && checks.length > 0;
    if (willRun) {
      const warning =
        values.mode === "pr" ? " Elles exécuteront le code de cette pull request." : "";
      const accepted = await confirm({
        title: "Lancer les vérifications ?",
        body: `Ces commandes vont s'exécuter sur ta machine : ${checks.join(", ")}.${warning}`,
        action: "Lancer",
      });
      if (!accepted) return;
    }
    start.mutate(
      {
        ...buildOptions(values, project),
        mode: values.mode as CleanMode,
        goal,
        run_checks: willRun,
        dry_run: dryRun,
      },
      { onSuccess: (job) => navigate(`/analyses/${job.id}`) },
    );
  }

  const failure = invalid ?? (start.error instanceof ApiError ? start.error.message : null);

  return (
    <form className="analysis-form" onSubmit={submit} noValidate>
      <ChoiceList
        legend="Que veux-tu nettoyer ?"
        value={values.mode as CleanMode}
        options={TARGETS}
        onChange={(mode) => update({ mode })}
      />
      <TargetFields values={values} project={project} onChange={update} />
      <Field label="Objectif" hint="Facultatif. Par exemple : retirer le code mort.">
        {(control) => (
          <TextInput {...control} value={goal} onChange={(event) => setGoal(event.target.value)} />
        )}
      </Field>
      <RunSettings values={values} onChange={update} />
      <CleanOptions
        project={project}
        runChecks={runChecks}
        dryRun={dryRun}
        onRunChecks={setRunChecks}
        onDryRun={setDryRun}
      />
      {failure && <Banner tone="error">{failure}</Banner>}
      <RunButton
        label="Lancer le nettoyage"
        maxCost={values.maxCost}
        needsProject={!project}
        pending={start.isPending}
        reassurance="Ton répertoire de travail n'est pas modifié : le résultat va sur une branche dédiée."
      />
    </form>
  );
}
