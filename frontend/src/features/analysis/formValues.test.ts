import { describe, expect, it } from "vitest";
import { project } from "../../test/fixtures";
import { buildOptions, initialTarget, validateTarget } from "./formValues";

const base = initialTarget("auto", project);

describe("initialTarget", () => {
  it("reprend les réglages du projet", () => {
    expect(base).toMatchObject({ effort: "high", maxCost: "5" });
  });

  it("garde des valeurs sûres sans projet", () => {
    expect(initialTarget("pr", null)).toMatchObject({ effort: "high", maxCost: "5" });
  });
});

describe("validateTarget", () => {
  it("accepte une cible complète", () => {
    expect(validateTarget(base)).toBeNull();
  });

  it("exige des chemins en mode fichiers", () => {
    expect(validateTarget({ ...base, mode: "paths", paths: "  " })).toMatch(/fichier/);
  });

  it.each(["", "0", "abc", "-3", "1.5"])("refuse le numéro de PR « %s »", (pr) => {
    expect(validateTarget({ ...base, mode: "pr", pr })).toMatch(/pull request/);
  });

  it.each(["0", "-1", "beaucoup"])("refuse le budget « %s »", (maxCost) => {
    expect(validateTarget({ ...base, maxCost })).toMatch(/budget/);
  });
});

describe("buildOptions", () => {
  it("reprend la base du projet si le champ est vide", () => {
    expect(buildOptions({ ...base, mode: "base" }, project).base).toBe("origin/main");
  });

  it("reprend le dépôt GitHub du projet", () => {
    const options = buildOptions({ ...base, mode: "pr", pr: "7" }, project);
    expect(options).toMatchObject({ pr: 7, repo: "acme/app" });
  });

  it("n'envoie pas les champs des autres modes", () => {
    const options = buildOptions(
      { ...base, mode: "auto", base: "x", paths: "y", pr: "1" },
      project,
    );
    expect(options).toEqual({ path: "/depots/app", effort: "high", max_cost: 5 });
  });

  it("fonctionne sans projet ouvert", () => {
    expect(buildOptions({ ...base, mode: "pr", pr: "7", repo: "a/b" }, null).path).toBeNull();
  });
});
