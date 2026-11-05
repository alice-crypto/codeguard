import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { status } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { CredentialsForm } from "./CredentialsForm";

afterEach(() => vi.unstubAllGlobals());

it("n'envoie que le champ rempli, puis le vide", async () => {
  const calls = mockApi({
    "GET /api/status": status,
    "POST /api/secrets": { anthropic: "session", github: null },
  });
  renderWithProviders(<CredentialsForm />);
  const input = screen.getByLabelText("Clé API Anthropic");
  await userEvent.type(input, "test-key");
  await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
  await waitFor(() => expect(input).toHaveValue(""));
  expect(calls.find((call) => call.route === "POST /api/secrets")?.body).toEqual({
    anthropic_key: "test-key",
  });
});

it("masque les clés à l'écran", () => {
  mockApi({ "GET /api/status": status });
  renderWithProviders(<CredentialsForm />);
  expect(screen.getByLabelText("Clé API Anthropic")).toHaveAttribute("type", "password");
  expect(screen.getByLabelText("Token GitHub")).toHaveAttribute("type", "password");
});

it("propose d'oublier uniquement les clés de session", async () => {
  const calls = mockApi({
    "GET /api/status": { ...status, credentials: { anthropic: "session", github: null } },
    "POST /api/secrets": { anthropic: "env", github: null },
  });
  renderWithProviders(<CredentialsForm />);
  await userEvent.click(await screen.findByRole("button", { name: "Oublier les clés de session" }));
  await waitFor(() =>
    expect(calls.at(-1)?.body).toEqual({ anthropic_key: "", github_token: "" }),
  );
});

it("ne propose pas d'oublier les clés d'environnement", async () => {
  mockApi({ "GET /api/status": status });
  renderWithProviders(<CredentialsForm />);
  await screen.findByText("Claude : environnement");
  expect(screen.queryByRole("button", { name: /Oublier/ })).not.toBeInTheDocument();
});
