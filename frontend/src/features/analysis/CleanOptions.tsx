import type { Project } from "../../api/types";
import { Checkbox } from "../../ui/Checkbox";
import "./CleanOptions.css";

interface CleanOptionsProps {
  project: Project | null;
  runChecks: boolean;
  dryRun: boolean;
  onRunChecks: (value: boolean) => void;
  onDryRun: (value: boolean) => void;
}

export function CleanOptions({
  project,
  runChecks,
  dryRun,
  onRunChecks,
  onDryRun,
}: CleanOptionsProps) {
  const checks = project?.config?.checks ?? [];
  const commands = [...checks, ...(project?.config?.formatters ?? [])];
  return (
    <div className="clean-options">
      <Checkbox
        checked={runChecks && checks.length > 0}
        disabled={checks.length === 0}
        onChange={onRunChecks}
        hint="Avant et après le nettoyage. Si elles échouent, rien n'est commité."
      >
        Lancer les vérifications du projet
      </Checkbox>
      <div className="clean-options__commands">
        {commands.length ? (
          commands.map((command) => <div key={command}>$ {command}</div>)
        ) : (
          <span>Aucune commande dans .codeguard.toml</span>
        )}
      </div>
      <Checkbox
        checked={dryRun}
        onChange={onDryRun}
        hint="Affiche le diff proposé sans créer de branche."
      >
        Aperçu seulement
      </Checkbox>
    </div>
  );
}
