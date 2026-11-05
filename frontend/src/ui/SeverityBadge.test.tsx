import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { Severity } from "../api/types";
import { SeverityBadge } from "./SeverityBadge";

it.each<[Severity, string]>([
  ["critical", "Critique"],
  ["high", "Élevée"],
  ["medium", "Moyenne"],
  ["low", "Faible"],
  ["info", "Info"],
])("écrit le niveau %s", (severity, label) => {
  render(<SeverityBadge severity={severity} />);
  expect(screen.getByText(label)).toBeInTheDocument();
});
