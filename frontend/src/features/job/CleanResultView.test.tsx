import { screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CleanJobDetail, CleanResult } from "../../api/types";
import { summary, usage } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { CleanResultView } from "./CleanResultView";

afterEach(() => vi.unstubAllGlobals());

function job(overrides: Partial<CleanResult>): CleanJobDetail {
  return {
    ...summary,
    kind: "clean",
    error: null,
    logs: [],
    log_count: 0,
    pushed: false,
    discarded: false,
    github_repo: null,
    pull_request_url: null,
    result: {
      target: "x",
      status: "committed",
      status_label: "Nettoyage commité",
      summary: "Import retiré",
      partial: false,
      changes: [{ path: "a.py", kind: "imports", description: "Import inutile" }],
      left_alone: ["Un bug à corriger séparément"],
      out_of_scope: [],
      branch: "codeguard/clean-1",
      commit: "abc",
      worktree: null,
      diff: "",
      checks_ran: true,
      checks_output: "",
      model: "claude-opus-5-5",
      usage,
      estimated_cost_usd: 0.1,
      ...overrides,
    },
  };
}

it("présente un nettoyage réussi", () => {
  mockApi({});
  renderWithProviders(<CleanResultView job={job({})} />);
  expect(screen.getByRole("heading", { name: "Nettoyage commité" })).toBeInTheDocument();
  expect(screen.getByText("git merge --squash codeguard/clean-1")).toBeInTheDocument();
  expect(screen.getByText("Import inutile")).toBeInTheDocument();
  expect(screen.getByText("Un bug à corriger séparément")).toBeInTheDocument();
});

it("alerte quand rien n'a été vérifié", () => {
  mockApi({});
  renderWithProviders(<CleanResultView job={job({ checks_ran: false })} />);
  expect(screen.getByText("Aucune vérification exécutée")).toBeInTheDocument();
});

it("montre la sortie des vérifications en échec", () => {
  mockApi({});
  renderWithProviders(
    <CleanResultView
      job={job({
        status: "checks_failed",
        status_label: "Vérifications en échec",
        checks_output: "1 test échoué",
        worktree: "/tmp/wt",
      })}
    />,
  );
  expect(screen.getByText("1 test échoué")).toBeInTheDocument();
  expect(screen.getByText("/tmp/wt")).toBeInTheDocument();
  expect(screen.queryByText(/git merge/)).not.toBeInTheDocument();
});

it("ne propose ni branche ni fusion pour un aperçu", () => {
  mockApi({});
  renderWithProviders(
    <CleanResultView job={job({ status: "dry_run", status_label: "Aperçu", branch: null })} />,
  );
  expect(screen.queryByText(/git merge/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Abandonner" })).not.toBeInTheDocument();
});
