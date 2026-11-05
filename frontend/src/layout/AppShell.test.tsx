import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

const scrollTo = vi.fn();

beforeEach(() => {
  scrollTo.mockClear();
  vi.stubGlobal("scrollTo", scrollTo);
});

afterEach(() => vi.unstubAllGlobals());

function setup() {
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<p>Accueil</p>} />
          <Route path="review" element={<p>Page de review</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

it("ne touche à rien au premier affichage", () => {
  setup();
  expect(scrollTo).not.toHaveBeenCalled();
  expect(screen.getByRole("main")).not.toHaveFocus();
});

it("revient en haut et place le focus sur le contenu", async () => {
  setup();
  await userEvent.click(screen.getByRole("link", { name: "Review" }));
  expect(await screen.findByText("Page de review")).toBeInTheDocument();
  expect(scrollTo).toHaveBeenCalledWith(0, 0);
  expect(screen.getByRole("main")).toHaveFocus();
});

it("propose un lien d'évitement vers le contenu", () => {
  setup();
  expect(screen.getByRole("link", { name: "Aller au contenu" })).toHaveAttribute(
    "href",
    "#contenu",
  );
});
