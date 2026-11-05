import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ActivityLog } from "./ActivityLog";

it("affiche les étapes et les compte", () => {
  render(<ActivityLog logs={["cible", "tour 1"]} open />);
  expect(screen.getByText("Activité · 2 étapes")).toBeInTheDocument();
  expect(screen.getByRole("log")).toHaveTextContent("cible");
});

it("rassure avant la première étape", () => {
  render(<ActivityLog logs={[]} open />);
  expect(screen.getByRole("log")).toHaveTextContent("Démarrage…");
});
