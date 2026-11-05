import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { readStored, writeStored } from "../../lib/storage";

export type ThemeChoice = "system" | "light" | "dark";
export type ReadingSize = "compact" | "normal" | "large";

const READING_SIZES: Record<ReadingSize, string> = {
  compact: "1rem",
  normal: "1.0625rem",
  large: "1.1875rem",
};

interface Preferences {
  theme: ThemeChoice;
  setTheme: (theme: ThemeChoice) => void;
  readingSize: ReadingSize;
  setReadingSize: (size: ReadingSize) => void;
}

const THEME_KEY = "codeguard.theme";
const READING_KEY = "codeguard.readingSize";
const PreferencesContext = createContext<Preferences | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeChoice>(() => readStored(THEME_KEY, "system"));

  const [readingSize, setReadingSize] = useState<ReadingSize>(() =>
    readStored(READING_KEY, "normal"),
  );

  useEffect(() => {
    writeStored(READING_KEY, readingSize);
    document.documentElement.style.setProperty("--reading-size", READING_SIZES[readingSize]);
  }, [readingSize]);

  useEffect(() => {
    writeStored(THEME_KEY, theme);
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  const value = useMemo(
    () => ({ theme, setTheme, readingSize, setReadingSize }),
    [theme, readingSize],
  );
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): Preferences {
  const preferences = useContext(PreferencesContext);
  if (!preferences) throw new Error("usePreferences doit être utilisé dans PreferencesProvider");
  return preferences;
}
