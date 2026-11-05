import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { CodeBlock } from "./CodeBlock";

it("affiche le HTML comme du texte", () => {
  const hostile = '<img src=x onerror="alert(1)">';
  const { container } = render(<CodeBlock code={hostile} />);
  expect(screen.getByText(hostile)).toBeInTheDocument();
  expect(container.querySelector("img")).toBeNull();
});
