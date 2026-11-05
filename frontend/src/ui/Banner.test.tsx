import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Banner } from "./Banner";

it("annonce une erreur", () => {
  render(<Banner tone="error" title="Échec" />);
  expect(screen.getByRole("alert")).toHaveTextContent("Échec");
});

it("n'interrompt pas pour un simple avertissement", () => {
  render(<Banner tone="warning">Attention</Banner>);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
