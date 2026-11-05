import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { PreferencesProvider, usePreferences } from "./PreferencesProvider";

function Sample() {
  const { setTheme, setReadingSize } = usePreferences();
  return (
    <>
      <button onClick={() => setTheme("dark")}>Sombre</button>
      <button onClick={() => setTheme("system")}>Système</button>
      <button onClick={() => setReadingSize("large")}>Grand</button>
    </>
  );
}

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

it("applique puis retire le thème", async () => {
  render(
    <PreferencesProvider>
      <Sample />
    </PreferencesProvider>,
  );
  await userEvent.click(screen.getByText("Sombre"));
  expect(document.documentElement.dataset.theme).toBe("dark");
  await userEvent.click(screen.getByText("Système"));
  expect(document.documentElement.dataset.theme).toBeUndefined();
});

it("mémorise les préférences", async () => {
  const first = render(
    <PreferencesProvider>
      <Sample />
    </PreferencesProvider>,
  );
  await userEvent.click(screen.getByText("Sombre"));
  await userEvent.click(screen.getByText("Grand"));
  first.unmount();
  render(
    <PreferencesProvider>
      <Sample />
    </PreferencesProvider>,
  );
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(document.documentElement.style.getPropertyValue("--reading-size")).toBe("1.1875rem");
});
