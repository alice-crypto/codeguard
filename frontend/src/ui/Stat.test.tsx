import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Stat } from "./Stat";

it("affiche le nombre sans la bibliothèque", () => {
  render(<Stat label="Remarques" value={1200} />);
  expect(screen.getByText("Remarques")).toBeInTheDocument();
  expect(document.querySelector('[data-fx="count-up"]')).toHaveAttribute("data-fx-to", "1200");
});

it("n'anime pas une valeur textuelle", () => {
  render(<Stat label="Coût" value="~0,04 $" />);
  expect(screen.getByText("~0,04 $")).toBeInTheDocument();
  expect(document.querySelector('[data-fx="count-up"]')).toBeNull();
});
