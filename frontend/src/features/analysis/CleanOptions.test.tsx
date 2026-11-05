import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { project } from "../../test/fixtures";
import { CleanOptions } from "./CleanOptions";

const handlers = { onRunChecks: vi.fn(), onDryRun: vi.fn() };

it("montre les commandes qui seront lancées", () => {
  render(<CleanOptions project={project} runChecks={false} dryRun={false} {...handlers} />);
  expect(screen.getByText("$ pytest -q")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: /vérifications/ })).toBeEnabled();
});

it("désactive les vérifications sans commande", () => {
  render(<CleanOptions project={null} runChecks dryRun={false} {...handlers} />);
  const box = screen.getByRole("checkbox", { name: /vérifications/ });
  expect(box).toBeDisabled();
  expect(box).not.toBeChecked();
  expect(screen.getByText(/Aucune commande/)).toBeInTheDocument();
});
