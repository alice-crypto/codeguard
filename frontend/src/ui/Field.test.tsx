import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Field } from "./Field";

function Sample({ error }: { error?: string }) {
  return (
    <Field label="Nom" hint="Une aide" error={error}>
      {(control) => <input {...control} />}
    </Field>
  );
}

it("relie le libellé au champ", () => {
  render(<Sample />);
  expect(screen.getByLabelText("Nom")).toBeInTheDocument();
});

it("décrit le champ par son aide", () => {
  render(<Sample />);
  expect(screen.getByLabelText("Nom")).toHaveAccessibleDescription("Une aide");
});

it("signale et annonce l'erreur", () => {
  render(<Sample error="Obligatoire" />);
  expect(screen.getByLabelText("Nom")).toBeInvalid();
  expect(screen.getByRole("alert")).toHaveTextContent("Obligatoire");
});
