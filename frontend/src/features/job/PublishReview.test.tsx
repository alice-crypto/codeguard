import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { useJob } from "../../api/hooks";
import type { ReviewJobDetail } from "../../api/types";
import { summary, usage } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { PublishReview } from "./PublishReview";

afterEach(() => vi.unstubAllGlobals());

const job: ReviewJobDetail = {
  ...summary,
  kind: "review",
  error: null,
  logs: [],
  log_count: 0,
  can_post: true,
  repo: "acme/app",
  result: {
    target: "PR #7",
    summary: "ok",
    partial: false,
    findings: [],
    dropped: [],
    posted_url: null,
    model: "claude-opus-5-5",
    usage,
    estimated_cost_usd: 0.01,
  },
};

function withUrl(posted_url: string): ReviewJobDetail {
  return { ...job, result: { ...job.result!, posted_url } };
}

function Live() {
  const { data } = useJob(job.id);
  return data?.kind === "review" ? <PublishReview job={data} /> : null;
}

it("ne publie rien sans confirmation", async () => {
  const calls = mockApi({ "GET /api/jobs/abc123": job });
  renderWithProviders(<Live />);
  await userEvent.click(await screen.findByRole("button", { name: "Publier sur la PR" }));
  expect(screen.getByText(/visibles par tous sur acme\/app/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
  expect(calls.some((call) => call.route.startsWith("POST"))).toBe(false);
});

it("publie après confirmation et affiche le lien", async () => {
  mockApi({
    "GET /api/jobs/abc123": job,
    "POST /api/jobs/abc123/post": withUrl("https://github.test/review/1"),
  });
  renderWithProviders(<Live />);
  await userEvent.click(await screen.findByRole("button", { name: "Publier sur la PR" }));
  await userEvent.click(screen.getByRole("button", { name: "Publier" }));
  await waitFor(() =>
    expect(screen.getByRole("link", { name: "voir la review" })).toHaveAttribute(
      "href",
      "https://github.test/review/1",
    ),
  );
});

it("ne rend pas cliquable une adresse dangereuse", () => {
  mockApi({});
  renderWithProviders(<PublishReview job={withUrl("javascript:alert(1)")} />);
  expect(screen.getByText("Publié sur GitHub")).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it("ne propose rien pour une review locale", () => {
  mockApi({});
  const { container } = renderWithProviders(<PublishReview job={{ ...job, can_post: false }} />);
  expect(container.querySelector("button")).toBeNull();
});
