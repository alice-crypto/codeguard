import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectProvider } from "../features/project/ProjectProvider";
import { rememberProject } from "../features/project/recentProjects";
import { project, summary } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { renderWithProviders } from "../test/render";
import { HomePage } from "./HomePage";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function setup() {
  renderWithProviders(
    <MemoryRouter>
      <ProjectProvider>
        <HomePage />
      </ProjectProvider>
    </MemoryRouter>,
  );
}

it("invite à ouvrir un projet et masque les chiffres vides", async () => {
  mockApi({ "GET /api/jobs": [] });
  setup();
  expect(await screen.findByRole("heading", { name: "Ouvre un projet" })).toBeInTheDocument();
  expect(screen.queryByText("Cette session")).not.toBeInTheDocument();
});

it("présente le projet et les analyses de la session", async () => {
  rememberProject("/depots/app");
  mockApi({ "GET /api/jobs": [summary], "POST /api/project": project });
  setup();
  expect(await screen.findByRole("heading", { name: "Projet : app" })).toBeInTheDocument();
  expect(await screen.findByText("Cette session")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /changements en cours/ })).toBeInTheDocument();
});

it("mène aux deux usages principaux", () => {
  mockApi({ "GET /api/jobs": [] });
  setup();
  expect(screen.getByRole("link", { name: /Lancer une review/ })).toHaveAttribute(
    "href",
    "/review",
  );
  expect(screen.getByRole("link", { name: /Nettoyer du code/ })).toHaveAttribute(
    "href",
    "/nettoyage",
  );
});
