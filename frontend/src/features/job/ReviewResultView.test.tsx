import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { ReviewJobDetail } from "../../api/types";
import { finding, summary, usage } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { ReviewResultView } from "./ReviewResultView";

afterEach(() => vi.unstubAllGlobals());

const low = { ...finding, severity: "low" as const, title: "Détail mineur" };

function job(overrides: Partial<NonNullable<ReviewJobDetail["result"]>> = {}): ReviewJobDetail {
  return {
    ...summary,
    kind: "review",
    error: null,
    logs: [],
    log_count: 0,
    can_post: false,
    result: {
      target: "x",
      summary: "Résumé de la review",
      partial: false,
      findings: [finding, low],
      dropped: [],
      posted_url: null,
      model: "claude-opus-5-5",
      usage,
      estimated_cost_usd: 0.04,
      ...overrides,
    },
  };
}

it("filtre les remarques affichées", async () => {
  mockApi({});
  renderWithProviders(<ReviewResultView job={job()} />);
  expect(screen.getAllByRole("article")).toHaveLength(2);
  await userEvent.click(screen.getByRole("button", { name: "Faible 1" }));
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "Détail mineur" })).toBeInTheDocument();
});

it("rassure quand il n'y a aucune remarque", () => {
  mockApi({});
  renderWithProviders(<ReviewResultView job={job({ findings: [] })} />);
  expect(screen.getByLabelText("Aucune remarque")).toBeInTheDocument();
  expect(screen.queryByRole("group")).not.toBeInTheDocument();
});

it("signale une review incomplète", () => {
  mockApi({});
  renderWithProviders(<ReviewResultView job={job({ partial: true })} />);
  expect(screen.getByText("Review incomplète")).toBeInTheDocument();
});

it("propose les exports", () => {
  mockApi({});
  renderWithProviders(<ReviewResultView job={job()} />);
  expect(screen.getByRole("link", { name: "SARIF" })).toHaveAttribute(
    "href",
    "/api/jobs/abc123/export?format=sarif",
  );
});

it("affiche la consommation estimée", () => {
  mockApi({});
  renderWithProviders(<ReviewResultView job={job()} />);
  expect(screen.getByText(/~0,04 \$ \(estimation\)/)).toBeInTheDocument();
});
