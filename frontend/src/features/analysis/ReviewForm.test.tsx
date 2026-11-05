import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { project, status, summary } from "../../test/fixtures";
import { MockError, mockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { rememberProject } from "../project/recentProjects";
import { ProjectProvider } from "../project/ProjectProvider";
import { ReviewForm } from "./ReviewForm";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const RUN = { name: /Lancer la review/ };

function setup() {
  renderWithProviders(
    <MemoryRouter initialEntries={["/review"]}>
      <ProjectProvider>
        <Routes>
          <Route path="/review" element={<ReviewForm />} />
          <Route path="/analyses/:id" element={<p>Suivi de l'analyse</p>} />
        </Routes>
      </ProjectProvider>
    </MemoryRouter>,
  );
}

const baseRoutes = { "GET /api/jobs": [], "GET /api/status": status };

it("relit une pull request sans projet ouvert", async () => {
  const calls = mockApi({ ...baseRoutes, "POST /api/review": summary });
  setup();
  await userEvent.click(screen.getByText("Pull request GitHub"));
  await userEvent.type(screen.getByLabelText("Numéro"), "7");
  await userEvent.type(screen.getByLabelText("Dépôt GitHub"), "acme/app");
  await userEvent.click(screen.getByRole("button", RUN));
  expect(await screen.findByText("Suivi de l'analyse")).toBeInTheDocument();
  expect(calls.find((call) => call.route === "POST /api/review")?.body).toMatchObject({
    mode: "pr",
    pr: 7,
    repo: "acme/app",
    path: null,
    min_severity: "low",
  });
});

it("bloque le lancement sans projet pour une cible locale", async () => {
  mockApi(baseRoutes);
  setup();
  await waitFor(() => expect(screen.getByRole("button", RUN)).toBeDisabled());
});

it("explique une saisie invalide sans appeler le serveur", async () => {
  const calls = mockApi(baseRoutes);
  setup();
  await userEvent.click(screen.getByText("Pull request GitHub"));
  await userEvent.click(screen.getByRole("button", RUN));
  expect(await screen.findByRole("alert")).toHaveTextContent("numéro de la pull request");
  expect(calls.some((call) => call.route === "POST /api/review")).toBe(false);
});

it("affiche le refus du serveur", async () => {
  rememberProject("/depots/app");
  mockApi({
    ...baseRoutes,
    "POST /api/project": project,
    "POST /api/review": new MockError("une analyse est déjà en cours", 409),
  });
  setup();
  await screen.findByText("Rien n'est publié sans ta confirmation.");
  await waitFor(() => expect(screen.getByRole("button", RUN)).toBeEnabled());
  await userEvent.click(screen.getByRole("button", RUN));
  expect(await screen.findByRole("alert")).toHaveTextContent("déjà en cours");
});
