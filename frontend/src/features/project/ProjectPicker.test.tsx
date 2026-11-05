import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { project } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { ProjectPicker } from "./ProjectPicker";
import { ProjectProvider } from "./ProjectProvider";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function setup() {
  renderWithProviders(
    <ProjectProvider>
      <ProjectPicker />
    </ProjectProvider>,
  );
}

it("désactive l'envoi sans chemin", () => {
  mockApi({});
  setup();
  expect(screen.getByRole("button", { name: "Ouvrir" })).toBeDisabled();
});

it("envoie le chemin sans espaces autour", async () => {
  const calls = mockApi({ "POST /api/project": project });
  setup();
  await userEvent.type(screen.getByLabelText("Dossier du dépôt git"), "  /depots/app  ");
  await userEvent.click(screen.getByRole("button", { name: "Ouvrir" }));
  expect(calls[0]).toEqual({ route: "POST /api/project", body: { path: "/depots/app" } });
});
