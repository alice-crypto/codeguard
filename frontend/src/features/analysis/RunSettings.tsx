import type { Effort } from "../../api/types";
import { effortLabels } from "../../lib/labels";
import { Field } from "../../ui/Field";
import { Select, TextInput } from "../../ui/inputs";
import type { TargetValues } from "./formValues";
import "./RunSettings.css";

const EFFORTS = Object.keys(effortLabels) as Effort[];

interface RunSettingsProps {
  values: TargetValues;
  onChange: (patch: Partial<TargetValues>) => void;
  children?: React.ReactNode;
}

export function RunSettings({ values, onChange, children }: RunSettingsProps) {
  return (
    <div className="run-settings">
      <Field label="Effort">
        {(control) => (
          <Select
            {...control}
            value={values.effort}
            onChange={(event) => onChange({ effort: event.target.value as Effort })}
          >
            {EFFORTS.map((effort) => (
              <option key={effort} value={effort}>
                {effortLabels[effort]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {children}
      <Field label="Budget maximal ($)">
        {(control) => (
          <TextInput
            {...control}
            type="number"
            min="0.01"
            step="any"
            value={values.maxCost}
            onChange={(event) => onChange({ maxCost: event.target.value })}
          />
        )}
      </Field>
    </div>
  );
}
