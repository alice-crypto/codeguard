import { render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useFx } from "./useFx";

function Sample() {
  const ref = useFx<HTMLDivElement>();
  return <div ref={ref} data-fx="fade-up" />;
}

afterEach(() => {
  delete window.FX;
});

it("initialise les effets depuis le parent", () => {
  const init = vi.fn();
  window.FX = { init, replay: vi.fn(), trigger: vi.fn() };
  const { container } = render(<Sample />);
  expect(init).toHaveBeenCalledWith(container);
});

it("reste silencieux sans la bibliothèque", () => {
  expect(() => render(<Sample />)).not.toThrow();
});
