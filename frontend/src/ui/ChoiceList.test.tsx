import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ChoiceList } from "./ChoiceList";

const OPTIONS = [
  { value: "a", label: "Alpha", hint: "Première" },
  { value: "b", label: "Bêta" },
] as const;

it("coche la valeur courante", () => {
  render(<ChoiceList legend="Choix" value="b" options={OPTIONS} onChange={vi.fn()} />);
  expect(screen.getByRole("radio", { name: "Bêta" })).toBeChecked();
});

it("signale le nouveau choix", async () => {
  const onChange = vi.fn();
  render(<ChoiceList legend="Choix" value="b" options={OPTIONS} onChange={onChange} />);
  await userEvent.click(screen.getByText("Alpha"));
  expect(onChange).toHaveBeenCalledWith("a");
});

it("regroupe les options pour le clavier", () => {
  render(<ChoiceList legend="Choix" value="a" options={OPTIONS} onChange={vi.fn()} />);
  const [first, second] = screen.getAllByRole("radio");
  expect(first).toHaveAttribute("name", second?.getAttribute("name"));
  expect(screen.getByRole("group", { name: "Choix" })).toBeInTheDocument();
});
