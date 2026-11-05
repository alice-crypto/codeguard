import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { DiffViewer } from "./DiffViewer";

const fileDiff = (name: string, added = "+nouveau") =>
  `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-ancien\n${added}\n`;

it("affiche le fichier et ses compteurs", () => {
  render(<DiffViewer diff={fileDiff("a.py")} />);
  expect(screen.getByText("a.py")).toBeInTheDocument();
  expect(screen.getByText("+1")).toBeInTheDocument();
  expect(screen.getByText("-1")).toBeInTheDocument();
});

it("ouvre les petits diffs", () => {
  const { container } = render(<DiffViewer diff={fileDiff("a.py")} />);
  expect(container.querySelector("details")).toHaveAttribute("open");
});

it("replie un diff portant sur beaucoup de fichiers", () => {
  const diff = Array.from({ length: 9 }, (_, index) => fileDiff(`f${index}.py`)).join("");
  const { container } = render(<DiffViewer diff={diff} />);
  expect(container.querySelector("details[open]")).toBeNull();
});

it("garde le HTML du code sous forme de texte", () => {
  const { container } = render(
    <DiffViewer diff={fileDiff("a.html", '+<img src=x onerror="alert(1)">')} />,
  );
  expect(container.querySelector(".diff-line img")).toBeNull();
  expect(screen.getByText('+<img src=x onerror="alert(1)">')).toBeInTheDocument();
});
