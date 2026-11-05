import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import { summary } from "../../test/fixtures";
import { JobList } from "./JobList";

function setup(jobs = [summary]) {
  render(
    <MemoryRouter>
      <JobList jobs={jobs} />
    </MemoryRouter>,
  );
}

it("mène à l'analyse", () => {
  setup();
  expect(screen.getByRole("link")).toHaveAttribute("href", "/analyses/abc123");
});

it.each([
  ["running", "En cours"],
  ["done", "Terminée"],
  ["failed", "En échec"],
  ["cancelled", "Arrêtée"],
] as const)("écrit l'état %s", (status, label) => {
  setup([{ ...summary, status }]);
  expect(screen.getByText(label)).toBeInTheDocument();
});
