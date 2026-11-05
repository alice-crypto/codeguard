import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { CopyButton } from "./CopyButton";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("copie le texte puis revient au libellé", async () => {
  const user = userEvent.setup();
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  render(<CopyButton text="git status" />);
  await user.click(screen.getByRole("button", { name: "Copier" }));
  expect(writeText).toHaveBeenCalledWith("git status");
  expect(screen.getByRole("button", { name: "Copié ✓" })).toBeInTheDocument();
  await act(() => new Promise((resolve) => setTimeout(resolve, 1700)));
  expect(screen.getByRole("button", { name: "Copier" })).toBeInTheDocument();
});

it("signale un presse-papiers refusé", async () => {
  const user = userEvent.setup();
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("refusé"));
  render(<CopyButton text="x" />);
  await user.click(screen.getByRole("button"));
  expect(screen.getByRole("button", { name: "Échec de la copie" })).toBeInTheDocument();
});
