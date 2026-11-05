import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import { Sidebar } from "./Sidebar";

function setup(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

it("expose tous les écrans", () => {
  setup("/");
  for (const name of ["Accueil", "Review", "Nettoyage", "Analyses", "Réglages"]) {
    expect(screen.getByRole("link", { name })).toBeInTheDocument();
  }
});

it("marque uniquement la page courante", () => {
  setup("/review");
  expect(screen.getByRole("link", { name: "Review" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Accueil" })).not.toHaveAttribute("aria-current");
});
