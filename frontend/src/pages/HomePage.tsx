import { useJobs } from "../api/hooks";
import { JobList } from "../features/history/JobList";
import { ProjectPicker } from "../features/project/ProjectPicker";
import { useProject } from "../features/project/ProjectProvider";
import { ProjectSummary } from "../features/project/ProjectSummary";
import { Card } from "../ui/Card";
import { Stat } from "../ui/Stat";
import { HomeActions } from "./HomeActions";
import { HomeHero } from "./HomeHero";
import "./pages.css";

const RECENT_JOBS = 4;

export function HomePage() {
  const { project } = useProject();
  const jobs = useJobs().data ?? [];
  const finished = jobs.filter((job) => job.status === "done").length;
  const failed = jobs.filter((job) => job.status === "failed").length;

  return (
    <div className="page">
      <HomeHero />
      <Card title={project ? `Projet : ${project.name}` : "Ouvre un projet"}>
        <ProjectPicker />
        {project && <ProjectSummary project={project} />}
      </Card>
      <HomeActions />
      {jobs.length > 0 && (
        <Card title="Cette session">
          <div className="home-stats">
            <Stat label="Analyses" value={jobs.length} />
            <Stat label="Terminées" value={finished} />
            <Stat label="En échec" value={failed} />
          </div>
          <JobList jobs={jobs.slice(0, RECENT_JOBS)} />
        </Card>
      )}
    </div>
  );
}
