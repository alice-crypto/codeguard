import { useState, type FormEvent } from "react";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { TextInput } from "../../ui/inputs";
import { useProject } from "./ProjectProvider";
import "./ProjectPicker.css";

export function ProjectPicker() {
  const { recent, opening, error, open, project } = useProject();
  const [path, setPath] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = path.trim();
    if (value) open(value);
  }

  return (
    <form className="project-picker" onSubmit={submit}>
      <Field label="Dossier du dépôt git" error={error}>
        {(control) => (
          <TextInput
            {...control}
            code
            list="projets-recents"
            value={path}
            placeholder={project?.root ?? "C:\\chemin\\vers\\le\\depot"}
            onChange={(event) => setPath(event.target.value)}
          />
        )}
      </Field>
      <datalist id="projets-recents">
        {recent.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
      <Button type="submit" variant="primary" disabled={opening || !path.trim()}>
        <span>{opening ? "Ouverture…" : "Ouvrir"}</span>
      </Button>
    </form>
  );
}
