import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Segmented } from "./Segmented";

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Bêta" },
] as const;

it("expose les onglets et la sélection", () => {
  render(<Segmented label="Mode" value="b" options={OPTIONS} onChange={vi.fn()} />);
  expect(screen.getByRole("tablist", { name: "Mode" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Bêta" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "false");
});

it("signale le changement d'onglet", async () => {
  const onChange = vi.fn();
  render(<Segmented label="Mode" value="b" options={OPTIONS} onChange={onChange} />);
  await userEvent.click(screen.getByRole("tab", { name: "Alpha" }));
  expect(onChange).toHaveBeenCalledWith("a");
});
