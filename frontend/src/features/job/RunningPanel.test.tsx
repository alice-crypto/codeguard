import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { JobDetail } from "../../api/types";
import { summary } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { RunningPanel } from "./RunningPanel";

afterEach(() => vi.unstubAllGlobals());

const job: JobDetail = {
  ...summary,
  kind: "review",
  status: "running",
  error: null,
  logs: [],
  log_count: 0,
  result: null,
};

it("demande l'arrêt au serveur", async () => {
  const calls = mockApi({ "POST /api/jobs/abc123/cancel": summary, "GET /api/jobs/abc123": job });
  renderWithProviders(<RunningPanel job={job} />);
  await userEvent.click(screen.getByRole("button", { name: "Arrêter" }));
  await waitFor(() => expect(calls[0]?.route).toBe("POST /api/jobs/abc123/cancel"));
});

it("explique un arrêt déjà demandé", () => {
  mockApi({});
  renderWithProviders(<RunningPanel job={{ ...job, cancel_requested: true }} />);
  expect(screen.getByRole("button", { name: "Arrêt demandé…" })).toBeDisabled();
  expect(screen.getByText(/fin de la requête en cours/)).toBeInTheDocument();
});
