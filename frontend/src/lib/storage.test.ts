import { afterEach, expect, it, vi } from "vitest";
import { readStored, writeStored } from "./storage";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it("relit ce qui a été écrit", () => {
  writeStored("cle", { a: 1 });
  expect(readStored("cle", null)).toEqual({ a: 1 });
});

it("renvoie la valeur par défaut sur un JSON corrompu", () => {
  localStorage.setItem("cle", "{pas du json");
  expect(readStored("cle", "defaut")).toBe("defaut");
});

it("survit à un stockage indisponible", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("refusé");
  });
  expect(() => writeStored("cle", 1)).not.toThrow();
});
