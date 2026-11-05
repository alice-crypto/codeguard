import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Button } from "./Button";

it("n'envoie pas de formulaire par défaut", () => {
  render(<Button>Valider</Button>);
  expect(screen.getByRole("button", { name: "Valider" })).toHaveAttribute("type", "button");
});

it("transmet le clic", async () => {
  const onClick = vi.fn();
  render(<Button onClick={onClick}>Valider</Button>);
  await userEvent.click(screen.getByRole("button"));
  expect(onClick).toHaveBeenCalledOnce();
});

it("ignore le clic une fois désactivé", async () => {
  const onClick = vi.fn();
  render(
    <Button disabled onClick={onClick}>
      Valider
    </Button>,
  );
  await userEvent.click(screen.getByRole("button"));
  expect(onClick).not.toHaveBeenCalled();
});
