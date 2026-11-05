import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { project } from "../../test/fixtures";
import { ProjectSummary } from "./ProjectSummary";

it("affiche les informations du projet", () => {
  render(<ProjectSummary project={project} />);
  expect(screen.getByText("feature/rapport")).toBeInTheDocument();
  expect(screen.getByText("3 fichiers")).toBeInTheDocument();
});

it("dit quand une information manque", () => {
  render(<ProjectSummary project={{ ...project, default_base: null, github_repo: null }} />);
  expect(screen.getByText("non détectée")).toBeInTheDocument();
  expect(screen.getByText("aucun")).toBeInTheDocument();
});

it("signale une configuration invalide", () => {
  render(<ProjectSummary project={{ ...project, config_error: "effort invalide" }} />);
  expect(screen.getByText("effort invalide")).toBeInTheDocument();
});
