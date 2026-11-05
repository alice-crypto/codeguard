import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./endpoints";
import type { ServerStatus } from "./types";

export const queryKeys = {
  status: ["status"] as const,
  jobs: ["jobs"] as const,
  job: (id: string) => ["jobs", id] as const,
};

const POLL_MS = 800;

export function useServerStatus() {
  return useQuery({ queryKey: queryKeys.status, queryFn: api.status });
}

export function useSaveSecrets() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.saveSecrets,
    onSuccess: (credentials) => {
      client.setQueryData<ServerStatus>(queryKeys.status, (status) =>
        status ? { ...status, credentials } : status,
      );
    },
  });
}

export function useJobs() {
  return useQuery({
    queryKey: queryKeys.jobs,
    queryFn: api.jobs,
    refetchInterval: (query) =>
      query.state.data?.some((job) => job.status === "running") ? POLL_MS : false,
  });
}

export function useStartReview() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.startReview,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.jobs }),
  });
}

export function useStartClean() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.startClean,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.jobs }),
  });
}

export function useJob(id: string) {
  return useQuery({
    queryKey: queryKeys.job(id),
    queryFn: () => api.job(id),
    refetchInterval: (query) => (query.state.data?.status === "running" ? POLL_MS : false),
  });
}
