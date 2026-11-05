import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { project, status, summary } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { ProjectProvider } from "../project/ProjectProvider";
import { rememberProject } from "../project/recentProjects";
import { CleanForm } from "./CleanForm";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const RUN = { name: /Lancer le nettoyage/ };

async function setup() {
  rememberProject("/depots/app");
  const calls = mockApi({
    "GET /api/jobs": [],
    "GET /api/status": status,
    "POST /api/project": project,
    "POST /api/clean": { ...summary, kind: "clean" },
  });
  renderWithProviders(
    <MemoryRouter initialEntries={["/nettoyage"]}>
      <ProjectProvider>
        <Routes>
          <Route path="/nettoyage" element={<Loaded />} />
          <Route path="/analyses/:id" element={<p>Suivi</p>} />
        </Routes>
      </ProjectProvider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByRole("button", RUN)).toBeEnabled());
  return calls;
}

function Loaded() {
  return <CleanForm />;
}

const cleanCalls = (calls: Array<{ route: string; body: unknown }>) =>
  calls.filter((call) => call.route === "POST /api/clean");

it("lance sans confirmation quand aucune commande ne s'exécute", async () => {
  const calls = await setup();
  await userEvent.type(screen.getByLabelText(/Objectif/), "code mort");
  await userEvent.click(screen.getByRole("button", RUN));
  expect(await screen.findByText("Suivi")).toBeInTheDocument();
  expect(cleanCalls(calls)[0]?.body).toMatchObject({
    mode: "base",
    base: "origin/main",
    goal: "code mort",
    run_checks: false,
    dry_run: false,
  });
});

it("demande confirmation avant de lancer des commandes", async () => {
  const calls = await setup();
  await waitFor(() => expect(screen.getByText("$ pytest -q")).toBeInTheDocument());
  await userEvent.click(screen.getByRole("checkbox", { name: /vérifications/ }));
  await userEvent.click(screen.getByRole("button", RUN));
  expect(await screen.findByText(/pytest -q\./)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
  expect(cleanCalls(calls)).toHaveLength(0);
});

it("lance les vérifications une fois confirmées", async () => {
  const calls = await setup();
  await userEvent.click(screen.getByRole("checkbox", { name: /vérifications/ }));
  await userEvent.click(screen.getByRole("button", RUN));
  await userEvent.click(await screen.findByRole("button", { name: "Lancer" }));
  await screen.findByText("Suivi");
  expect(cleanCalls(calls)[0]?.body).toMatchObject({ run_checks: true });
});

it("alerte sur le code d'une pull request", async () => {
  await setup();
  await userEvent.click(screen.getByText("Fichiers d'une pull request"));
  await userEvent.type(screen.getByLabelText("Numéro"), "7");
  await userEvent.click(screen.getByRole("checkbox", { name: /vérifications/ }));
  await userEvent.click(screen.getByRole("button", RUN));
  expect(await screen.findByText(/exécuteront le code de cette pull request/)).toBeInTheDocument();
});
