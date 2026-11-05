import { expect, it } from "vitest";
import { finding } from "../../test/fixtures";
import { countBySeverity, filterFindings, findingLocation } from "./findings";

const low = { ...finding, severity: "low" as const };
const critical = { ...finding, severity: "critical" as const };

it("compte du plus grave au moins grave, sans les niveaux absents", () => {
  expect([...countBySeverity([low, critical, low])]).toEqual([
    ["critical", 1],
    ["low", 2],
  ]);
});

it("filtre par sévérité", () => {
  expect(filterFindings([low, critical], "critical")).toEqual([critical]);
});

it("garde tout sans filtre", () => {
  expect(filterFindings([low, critical], null)).toHaveLength(2);
});

it("note une ligne ou une plage", () => {
  expect(findingLocation(finding)).toBe("src/app.py:12");
  expect(findingLocation({ ...finding, end_line: 15 })).toBe("src/app.py:12-15");
});
