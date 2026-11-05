import { describe, expect, it } from "vitest";
import { formatCost, formatDuration, plural } from "./format";

describe("plural", () => {
  it("accorde au singulier jusqu'à 1", () => {
    expect(plural(1, "fichier")).toBe("1 fichier");
    expect(plural(0, "fichier")).toBe("0 fichier");
  });

  it("accepte une forme irrégulière", () => {
    expect(plural(2, "remarque écartée", "remarques écartées")).toBe("2 remarques écartées");
  });
});

describe("formatCost", () => {
  it("affiche une estimation à la française", () => {
    expect(formatCost(0.042)).toBe("~0,04 $");
  });

  it("n'invente pas de coût", () => {
    expect(formatCost(null)).toBe("coût inconnu");
  });
});

describe("formatDuration", () => {
  it("garde les secondes sous la minute", () => {
    expect(formatDuration(42.4)).toBe("42 s");
  });

  it("omet les secondes sur une minute ronde", () => {
    expect(formatDuration(120)).toBe("2 min");
    expect(formatDuration(135)).toBe("2 min 15 s");
  });
});
