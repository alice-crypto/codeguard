import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { CleanJobDetail, CleanResult } from "../../api/types";
import { summary, usage } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { CleanActions } from "./CleanActions";

afterEach(() => vi.unstubAllGlobals());

const result: CleanResult = {
  target: "x",
  status: "committed",
  status_label: "Nettoyage commité",
  summary: "ok",
  partial: false,
  changes: [],
  left_alone: [],
  out_of_scope: [],
  branch: "codeguard/clean-1",
  commit: "abc",
  worktree: null,
  diff: "",
  checks_ran: false,
  checks_output: "",
  model: "claude-opus-5-5",
  usage,
  estimated_cost_usd: 0.1,
};

const job: CleanJobDetail = {
  ...summary,
  kind: "clean",
  error: null,
  logs: [],
  log_count: 0,
  pushed: false,
  discarded: false,
  github_repo: "acme/app",
  pull_request_url: null,
  result,
};

const writes = (calls: Array<{ route: string; body: unknown }>) =>
  calls.filter((call) => call.route.startsWith("POST"));

it("ne pousse rien sans confirmation", async () => {
  const calls = mockApi({});
  renderWithProviders(<CleanActions job={job} />);
  await userEvent.click(screen.getByRole("button", { name: "Pousser la branche" }));
  await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
  expect(writes(calls)).toHaveLength(0);
});

it("ouvre une pull request après confirmation", async () => {
  const calls = mockApi({ "POST /api/jobs/abc123/push": job });
  renderWithProviders(<CleanActions job={job} />);
  await userEvent.click(screen.getByRole("button", { name: "Ouvrir une PR" }));
  await userEvent.click(screen.getByRole("button", { name: "Ouvrir la PR" }));
  await waitFor(() => expect(writes(calls)[0]?.body).toEqual({ open_pr: true }));
});

it("abandonne après confirmation", async () => {
  const calls = mockApi({ "POST /api/jobs/abc123/discard": job });
  renderWithProviders(<CleanActions job={job} />);
  await userEvent.click(screen.getByRole("button", { name: "Abandonner" }));
  expect(screen.getByText(/sera supprimée/)).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole("button", { name: "Abandonner" }).at(-1)!);
  await waitFor(() => expect(writes(calls)[0]?.route).toBe("POST /api/jobs/abc123/discard"));
});

it("retire l'abandon après un push", () => {
  mockApi({});
  renderWithProviders(<CleanActions job={{ ...job, pushed: true }} />);
  expect(screen.queryByRole("button", { name: "Abandonner" })).not.toBeInTheDocument();
  expect(screen.getByText(/Branche poussée/)).toBeInTheDocument();
});

it("ne propose pas de PR sans dépôt GitHub", () => {
  mockApi({});
  renderWithProviders(<CleanActions job={{ ...job, github_repo: null }} />);
  expect(screen.queryByRole("button", { name: "Ouvrir une PR" })).not.toBeInTheDocument();
});

it("permet d'abandonner une branche en échec, sans la pousser", () => {
  mockApi({});
  renderWithProviders(
    <CleanActions job={{ ...job, result: { ...result, status: "checks_failed" } }} />,
  );
  expect(screen.getByRole("button", { name: "Abandonner" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Pousser la branche" })).not.toBeInTheDocument();
});
