import { readStored, writeStored } from "../../lib/storage";

const KEY = "codeguard.recentProjects";
const LIMIT = 8;

export function readRecentProjects(): string[] {
  const stored = readStored<unknown>(KEY, []);
  return Array.isArray(stored) ? stored.filter((item) => typeof item === "string") : [];
}

export function rememberProject(path: string): string[] {
  const recent = [path, ...readRecentProjects().filter((item) => item !== path)].slice(0, LIMIT);
  writeStored(KEY, recent);
  return recent;
}

export function forgetProject(path: string): string[] {
  const recent = readRecentProjects().filter((item) => item !== path);
  writeStored(KEY, recent);
  return recent;
}
