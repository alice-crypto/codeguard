import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Checkbox } from "./Checkbox";

it("réagit au clic sur le libellé", async () => {
  const onChange = vi.fn();
  render(
    <Checkbox checked={false} onChange={onChange}>
      Option
    </Checkbox>,
  );
  await userEvent.click(screen.getByText("Option"));
  expect(onChange).toHaveBeenCalledWith(true);
});

it("reste inerte une fois désactivée", async () => {
  const onChange = vi.fn();
  render(
    <Checkbox checked={false} disabled onChange={onChange}>
      Option
    </Checkbox>,
  );
  await userEvent.click(screen.getByRole("checkbox"));
  expect(onChange).not.toHaveBeenCalled();
});
