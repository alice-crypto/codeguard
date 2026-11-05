import { afterEach, expect, it } from "vitest";
import { forgetProject, readRecentProjects, rememberProject } from "./recentProjects";

afterEach(() => localStorage.clear());

it("place le plus récent en tête, sans doublon", () => {
  rememberProject("/a");
  rememberProject("/b");
  expect(rememberProject("/a")).toEqual(["/a", "/b"]);
});

it("limite la liste à huit projets", () => {
  for (let index = 0; index < 12; index += 1) rememberProject(`/p${index}`);
  expect(readRecentProjects()).toHaveLength(8);
  expect(readRecentProjects()[0]).toBe("/p11");
});

it("oublie un projet", () => {
  rememberProject("/a");
  expect(forgetProject("/a")).toEqual([]);
});

it("ignore un stockage corrompu", () => {
  localStorage.setItem("codeguard.recentProjects", '{"pas":"une liste"}');
  expect(readRecentProjects()).toEqual([]);
});
