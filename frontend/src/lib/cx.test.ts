import { expect, it } from "vitest";
import { cx } from "./cx";

it("ignore les valeurs fausses", () => {
  expect(cx("a", false, null, undefined, "b")).toBe("a b");
});

it("renvoie une chaîne vide sans classe", () => {
  expect(cx(false)).toBe("");
});
