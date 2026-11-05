import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { readStored, writeStored } from "../../lib/storage";

export type ThemeChoice = "system" | "light" | "dark";

interface Preferences {
  theme: ThemeChoice;
  setTheme: (theme: ThemeChoice) => void;
}

const THEME_KEY = "codeguard.theme";
const PreferencesContext = createContext<Preferences | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeChoice>(() => readStored(THEME_KEY, "system"));

  useEffect(() => {
    writeStored(THEME_KEY, theme);
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  const value = useMemo(() => ({ theme, setTheme }), [theme]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): Preferences {
  const preferences = useContext(PreferencesContext);
  if (!preferences) throw new Error("usePreferences doit être utilisé dans PreferencesProvider");
  return preferences;
}
