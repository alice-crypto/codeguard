import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ConfirmProvider, useConfirm } from "./confirm";

function Trigger({ onResult }: { onResult: (value: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <button
      onClick={async () =>
        onResult(await confirm({ title: "Publier ?", body: "Visible par tous", action: "Publier" }))
      }
    >
      Ouvrir
    </button>
  );
}

function setup() {
  const onResult = vi.fn();
  render(
    <ConfirmProvider>
      <Trigger onResult={onResult} />
    </ConfirmProvider>,
  );
  return onResult;
}

it("renvoie true après validation", async () => {
  const onResult = setup();
  await userEvent.click(screen.getByText("Ouvrir"));
  expect(screen.getByText("Visible par tous")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Publier" }));
  expect(onResult).toHaveBeenCalledWith(true);
  expect(screen.queryByText("Visible par tous")).not.toBeInTheDocument();
});

it("renvoie false après annulation", async () => {
  const onResult = setup();
  await userEvent.click(screen.getByText("Ouvrir"));
  await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
  expect(onResult).toHaveBeenCalledWith(false);
});
