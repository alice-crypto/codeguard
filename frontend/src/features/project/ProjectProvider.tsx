import { useMutation } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError } from "../../api/client";
import { api } from "../../api/endpoints";
import type { Project } from "../../api/types";
import { forgetProject, readRecentProjects, rememberProject } from "./recentProjects";

interface ProjectState {
  project: Project | null;
  recent: string[];
  opening: boolean;
  error: string | null;
  open: (path: string) => void;
  refresh: () => void;
}

const ProjectContext = createContext<ProjectState | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<Project | null>(null);
  const [recent, setRecent] = useState(readRecentProjects);
  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: api.openProject,
    onSuccess: (opened) => {
      setProject(opened);
      setRecent(rememberProject(opened.root));
    },
  });

  const open = useCallback((path: string) => mutate(path), [mutate]);
  const refresh = useCallback(() => {
    if (project) mutate(project.root);
  }, [mutate, project]);

  useEffect(() => {
    const [last] = readRecentProjects();
    if (!last) return;
    api
      .openProject(last)
      .then(setProject)
      .catch(() => {
        setRecent(forgetProject(last));
        reset();
      });
  }, [reset]);

  const value = useMemo(
    () => ({
      project,
      recent,
      opening: isPending,
      error: error instanceof ApiError ? error.message : null,
      open,
      refresh,
    }),
    [project, recent, isPending, error, open, refresh],
  );
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectState {
  const state = useContext(ProjectContext);
  if (!state) throw new Error("useProject doit être utilisé dans ProjectProvider");
  return state;
}
