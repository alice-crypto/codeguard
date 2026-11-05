import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./toast";

function Trigger() {
  const notify = useToast();
  return <button onClick={() => notify("Enregistré")}>Agir</button>;
}

afterEach(() => {
  delete window.FX;
});

it("transmet le message à l'effet toast", async () => {
  const trigger = vi.fn();
  window.FX = { init: vi.fn(), replay: vi.fn(), trigger };
  const { container } = render(
    <ToastProvider>
      <Trigger />
    </ToastProvider>,
  );
  await userEvent.click(screen.getByText("Agir"));
  const region = container.querySelector<HTMLElement>('[data-fx="toast"]');
  expect(trigger).toHaveBeenCalledWith(region);
  expect(region?.dataset.fxMessage).toBe("Enregistré");
});

it("reste sans effet si la bibliothèque manque", async () => {
  render(
    <ToastProvider>
      <Trigger />
    </ToastProvider>,
  );
  await expect(userEvent.click(screen.getByText("Agir"))).resolves.toBeUndefined();
});
