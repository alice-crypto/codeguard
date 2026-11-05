import type { Project } from "../../api/types";
import { Field } from "../../ui/Field";
import { TextArea, TextInput } from "../../ui/inputs";
import type { TargetValues } from "./formValues";
import "./TargetFields.css";

interface TargetFieldsProps {
  values: TargetValues;
  project: Project | null;
  onChange: (patch: Partial<TargetValues>) => void;
}

export function TargetFields({ values, project, onChange }: TargetFieldsProps) {
  if (values.mode === "base") {
    return (
      <Field label="Référence de base" hint="Une branche, un tag ou un commit.">
        {(control) => (
          <TextInput
            {...control}
            code
            value={values.base}
            placeholder={project?.default_base ?? "origin/main"}
            onChange={(event) => onChange({ base: event.target.value })}
          />
        )}
      </Field>
    );
  }
  if (values.mode === "paths") {
    return (
      <Field label="Fichiers ou dossiers" hint="Relatifs au dépôt, un par ligne.">
        {(control) => (
          <TextArea
            {...control}
            code
            rows={3}
            value={values.paths}
            placeholder="src/api"
            onChange={(event) => onChange({ paths: event.target.value })}
          />
        )}
      </Field>
    );
  }
  if (values.mode === "pr") {
    return (
      <div className="target-pr">
        <Field label="Numéro">
          {(control) => (
            <TextInput
              {...control}
              inputMode="numeric"
              value={values.pr}
              placeholder="42"
              onChange={(event) => onChange({ pr: event.target.value })}
            />
          )}
        </Field>
        <Field label="Dépôt GitHub">
          {(control) => (
            <TextInput
              {...control}
              code
              value={values.repo}
              placeholder={project?.github_repo ?? "owner/nom"}
              onChange={(event) => onChange({ repo: event.target.value })}
            />
          )}
        </Field>
      </div>
    );
  }
  return null;
}
