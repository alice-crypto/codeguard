import { render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PageHeader } from "./PageHeader";

afterEach(() => {
  document.title = "";
});

it("affiche le titre, l'introduction et les actions", () => {
  render(<PageHeader title="Analyses" lead="Celles de la session" actions={<button>Agir</button>} />);
  expect(screen.getByRole("heading", { level: 1, name: "Analyses" })).toBeInTheDocument();
  expect(screen.getByText("Celles de la session")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Agir" })).toBeInTheDocument();
});

it("met à jour le titre de l'onglet", () => {
  render(<PageHeader title="Analyses" />);
  expect(document.title).toBe("Analyses · codeguard");
});

it("restaure le titre neutre en quittant la page", () => {
  const { unmount } = render(<PageHeader title="Analyses" />);
  unmount();
  expect(document.title).toBe("codeguard");
});
