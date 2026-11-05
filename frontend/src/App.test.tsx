import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createQueryClient } from "./api/queryClient";
import { App } from "./App";
import { ProjectProvider } from "./features/project/ProjectProvider";
import { PreferencesProvider } from "./features/preferences/PreferencesProvider";
import { status } from "./test/fixtures";
import { mockApi } from "./test/mockApi";
import { ConfirmProvider } from "./ui/confirm";
import { ToastProvider } from "./ui/toast";

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

function setup(hash: string) {
  window.location.hash = hash;
  mockApi({ "GET /api/jobs": [], "GET /api/status": status });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <PreferencesProvider>
        <ToastProvider>
          <ConfirmProvider>
            <ProjectProvider>
              <App />
            </ProjectProvider>
          </ConfirmProvider>
        </ToastProvider>
      </PreferencesProvider>
    </QueryClientProvider>,
  );
}

it.each([
  ["#/", "Relis ton code, sans te presser."],
  ["#/review", "Nouvelle review"],
  ["#/nettoyage", "Nouveau nettoyage"],
  ["#/analyses", "Analyses"],
  ["#/reglages", "Réglages"],
  ["#/inconnue", "Cette page n'existe pas"],
])("%s affiche son écran", async (hash, heading) => {
  setup(hash);
  expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
});
