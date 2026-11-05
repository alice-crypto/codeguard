import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { finding } from "../../test/fixtures";
import { FindingFilters } from "./FindingFilters";

const findings = [finding, { ...finding, severity: "low" as const }];

it("ne propose que les niveaux présents", () => {
  render(<FindingFilters findings={findings} active={null} onChange={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Élevée 1" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Critique/ })).not.toBeInTheDocument();
});

it("marque le filtre actif", () => {
  render(<FindingFilters findings={findings} active="low" onChange={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Faible 1" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Toutes 2" })).toHaveAttribute("aria-pressed", "false");
});

it("permet de revenir à toutes les remarques", async () => {
  const onChange = vi.fn();
  render(<FindingFilters findings={findings} active="low" onChange={onChange} />);
  await userEvent.click(screen.getByRole("button", { name: "Toutes 2" }));
  expect(onChange).toHaveBeenCalledWith(null);
});
