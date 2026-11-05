import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import type { JobDetail } from "../../api/types";
import { summary, usage } from "../../test/fixtures";
import { MockError, mockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { JobView } from "./JobView";

afterEach(() => vi.unstubAllGlobals());

const base: JobDetail = {
  ...summary,
  kind: "review",
  error: null,
  logs: ["cible : x"],
  log_count: 1,
  result: null,
};

function setup(job: JobDetail | MockError) {
  mockApi({ "GET /api/jobs/abc123": job, "GET /api/jobs": [] });
  renderWithProviders(
    <MemoryRouter>
      <JobView id="abc123" />
    </MemoryRouter>,
  );
}

it("montre une analyse en cours", async () => {
  setup({ ...base, status: "running", finished: null });
  expect(await screen.findByRole("button", { name: "Arrêter" })).toBeInTheDocument();
  expect(screen.getByRole("log")).toHaveTextContent("cible : x");
});

it("montre l'erreur d'une analyse échouée", async () => {
  setup({ ...base, status: "failed", error: "clé API refusée" });
  expect(await screen.findByText("clé API refusée")).toBeInTheDocument();
});

it("montre une analyse arrêtée", async () => {
  setup({ ...base, status: "cancelled" });
  expect(await screen.findByText("Analyse arrêtée")).toBeInTheDocument();
});

it("montre le résultat d'une analyse terminée", async () => {
  setup({
    ...base,
    result: {
      target: "x",
      summary: "Tout va bien",
      partial: false,
      findings: [],
      dropped: [],
      posted_url: null,
      model: "claude-opus-5-5",
      usage,
      estimated_cost_usd: 0.01,
    },
  });
  expect(await screen.findByText("Tout va bien")).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: /Review : changements en cours/ }),
  ).toBeInTheDocument();
  expect(screen.getByText(/30 s/)).toBeInTheDocument();
});

it("explique une analyse disparue", async () => {
  setup(new MockError("analyse introuvable", 404));
  expect(await screen.findByText(/perdu à l'arrêt du serveur/)).toBeInTheDocument();
});
