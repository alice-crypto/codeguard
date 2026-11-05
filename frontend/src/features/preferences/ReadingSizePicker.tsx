import { Prose } from "../../ui/Prose";
import { Segmented } from "../../ui/Segmented";
import { usePreferences, type ReadingSize } from "./PreferencesProvider";

const OPTIONS: ReadonlyArray<{ value: ReadingSize; label: string }> = [
  { value: "compact", label: "Compacte" },
  { value: "normal", label: "Normale" },
  { value: "large", label: "Grande" },
];

export function ReadingSizePicker() {
  const { readingSize, setReadingSize } = usePreferences();
  return (
    <>
      <Segmented
        label="Taille de lecture"
        value={readingSize}
        options={OPTIONS}
        onChange={setReadingSize}
      />
      <Prose>
        Les explications d'une review s'affichent ainsi : une colonne étroite et un interligne
        généreux, pour lire sans se fatiguer.
      </Prose>
    </>
  );
}
