import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MockError, mockApi } from "../../test/mockApi";
import { project } from "../../test/fixtures";
import { renderWithProviders } from "../../test/render";
import { ProjectProvider, useProject } from "./ProjectProvider";
import { readRecentProjects, rememberProject } from "./recentProjects";

function Sample() {
  const state = useProject();
  return (
    <>
      <button onClick={() => state.open("/depots/app")}>Ouvrir</button>
      <p>{state.project?.name ?? "aucun"}</p>
      {state.error && <p>{state.error}</p>}
    </>
  );
}

function setup() {
  renderWithProviders(
    <ProjectProvider>
      <Sample />
    </ProjectProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

it("ouvre un projet et le mémorise", async () => {
  mockApi({ "POST /api/project": project });
  setup();
  await userEvent.click(screen.getByText("Ouvrir"));
  expect(await screen.findByText("app")).toBeInTheDocument();
  expect(readRecentProjects()).toEqual(["/depots/app"]);
});

it("affiche l'erreur du serveur", async () => {
  mockApi({ "POST /api/project": new MockError("dossier introuvable") });
  setup();
  await userEvent.click(screen.getByText("Ouvrir"));
  expect(await screen.findByText("dossier introuvable")).toBeInTheDocument();
});

it("rouvre le dernier projet au démarrage", async () => {
  rememberProject("/depots/app");
  mockApi({ "POST /api/project": project });
  setup();
  expect(await screen.findByText("app")).toBeInTheDocument();
});

it("oublie en silence un projet disparu", async () => {
  rememberProject("/disparu");
  mockApi({ "POST /api/project": new MockError("dossier introuvable") });
  setup();
  await waitFor(() => expect(readRecentProjects()).toEqual([]));
  expect(screen.queryByText("dossier introuvable")).not.toBeInTheDocument();
});
