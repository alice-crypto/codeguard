import { CleanForm } from "../features/analysis/CleanForm";
import { ReviewForm } from "../features/analysis/ReviewForm";
import { useProject } from "../features/project/ProjectProvider";
import { Reveal } from "../fx/Reveal";
import { PageHeader } from "../ui/PageHeader";
import "./pages.css";

export function ReviewPage() {
  const { project } = useProject();
  return (
    <div className="page">
      <PageHeader
        title="Nouvelle review"
        lead="L'agent lit le code, confirme ce qu'il avance, puis te remet un rapport à relire tranquillement."
      />
      <Reveal>
        <ReviewForm key={project?.root ?? "aucun"} />
      </Reveal>
    </div>
  );
}

export function CleanPage() {
  const { project } = useProject();
  return (
    <div className="page">
      <PageHeader
        title="Nouveau nettoyage"
        lead="Du code plus simple, au comportement identique. Le travail se fait sur une branche à part, sans toucher à ton répertoire."
      />
      <Reveal>
        <CleanForm key={project?.root ?? "aucun"} />
      </Reveal>
    </div>
  );
}
