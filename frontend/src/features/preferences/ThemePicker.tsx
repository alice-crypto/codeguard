import { Icon } from "../../ui/Icon";
import { Segmented } from "../../ui/Segmented";
import { usePreferences, type ThemeChoice } from "./PreferencesProvider";

const OPTIONS: ReadonlyArray<{ value: ThemeChoice; label: React.ReactNode }> = [
  { value: "system", label: <><Icon name="monitor" size={16} />Système</> },
  { value: "light", label: <><Icon name="sun" size={16} />Clair</> },
  { value: "dark", label: <><Icon name="moon" size={16} />Sombre</> },
];

export function ThemePicker() {
  const { theme, setTheme } = usePreferences();
  return <Segmented label="Thème" value={theme} options={OPTIONS} onChange={setTheme} />;
}
