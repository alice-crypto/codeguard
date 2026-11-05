import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { finding } from "../../test/fixtures";
import { FindingCard } from "./FindingCard";

it("affiche la remarque et sa suggestion", () => {
  render(<FindingCard finding={finding} />);
  expect(screen.getByRole("heading", { name: "Division par zéro" })).toBeInTheDocument();
  expect(screen.getByText("src/app.py:12")).toBeInTheDocument();
  expect(screen.getByText(finding.suggested_code)).toBeInTheDocument();
});

it("n'affiche pas de bloc de code sans suggestion", () => {
  render(<FindingCard finding={{ ...finding, suggested_code: "" }} />);
  expect(screen.queryByRole("button", { name: "Copier" })).not.toBeInTheDocument();
});

it("signale une faible confiance", () => {
  render(<FindingCard finding={{ ...finding, confidence: "low" }} />);
  expect(screen.getByText("À vérifier")).toBeInTheDocument();
});

it("garde le HTML hostile sous forme de texte", () => {
  const hostile = '<img src=x onerror="alert(1)">';
  const { container } = render(
    <FindingCard finding={{ ...finding, title: hostile, explanation: hostile }} />,
  );
  expect(screen.getByRole("heading")).toHaveTextContent(hostile);
  expect(container.querySelector("img")).toBeNull();
});
