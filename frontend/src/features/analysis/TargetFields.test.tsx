import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { project } from "../../test/fixtures";
import { initialTarget } from "./formValues";
import { TargetFields } from "./TargetFields";

it("n'affiche aucun champ en mode automatique", () => {
  const { container } = render(
    <TargetFields values={initialTarget("auto", project)} project={project} onChange={vi.fn()} />,
  );
  expect(container).toBeEmptyDOMElement();
});

it("propose la base du projet en exemple", () => {
  render(
    <TargetFields values={initialTarget("base", project)} project={project} onChange={vi.fn()} />,
  );
  expect(screen.getByLabelText("Référence de base")).toHaveAttribute("placeholder", "origin/main");
});

it("met à jour le numéro de pull request", async () => {
  const onChange = vi.fn();
  render(
    <TargetFields values={initialTarget("pr", project)} project={project} onChange={onChange} />,
  );
  await userEvent.type(screen.getByLabelText("Numéro"), "7");
  expect(onChange).toHaveBeenCalledWith({ pr: "7" });
});
