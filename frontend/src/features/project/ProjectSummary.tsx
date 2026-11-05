import { plural } from "../../lib/format";
import { Banner } from "../../ui/Banner";
import { FactList } from "../../ui/FactList";
import type { Project } from "../../api/types";

export function ProjectSummary({ project }: { project: Project }) {
  return (
    <>
      <FactList
        facts={[
          ["Dossier", project.root],
          ["Branche", project.branch],
          ["Base", project.default_base ?? "non détectée"],
          ["Modifiés", plural(project.changed_files, "fichier")],
          ["GitHub", project.github_repo ?? "aucun"],
        ]}
      />
      {project.config_error && (
        <Banner tone="warning" title="Configuration ignorée">
          {project.config_error}
        </Banner>
      )}
    </>
  );
}
