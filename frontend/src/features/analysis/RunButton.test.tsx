import { screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { status, summary } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { RunButton } from "./RunButton";

afterEach(() => vi.unstubAllGlobals());

function setup(needsProject = false) {
  renderWithProviders(
    <RunButton
      label="Lancer"
      maxCost="5"
      needsProject={needsProject}
      pending={false}
      reassurance="Rien n'est publié."
    />,
  );
  return screen.getByRole("button", { name: "Lancer · 5 $ max" });
}

it("rappelle le budget et rassure", async () => {
  mockApi({ "GET /api/jobs": [], "GET /api/status": status });
  const button = setup();
  await screen.findByText("Rien n'est publié.");
  expect(button).toBeEnabled();
});

it("bloque pendant une autre analyse", async () => {
  mockApi({ "GET /api/jobs": [{ ...summary, status: "running" }], "GET /api/status": status });
  const button = setup();
  await screen.findByText("Une analyse est déjà en cours.");
  expect(button).toBeDisabled();
});

it("demande d'ouvrir un projet", async () => {
  mockApi({ "GET /api/jobs": [], "GET /api/status": status });
  const button = setup(true);
  await waitFor(() => expect(button).toBeDisabled());
  expect(screen.getByText("Ouvre d'abord un projet.")).toBeInTheDocument();
});

it("signale l'absence de clé", async () => {
  mockApi({
    "GET /api/jobs": [],
    "GET /api/status": { ...status, credentials: { anthropic: null, github: null } },
  });
  setup();
  expect(await screen.findByText(/Aucune clé Claude/)).toBeInTheDocument();
});
