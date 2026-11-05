import { useId } from "react";
import "./ChoiceList.css";

export interface Choice<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

interface ChoiceListProps<T extends string> {
  legend: string;
  value: T;
  options: ReadonlyArray<Choice<T>>;
  onChange: (value: T) => void;
}

export function ChoiceList<T extends string>({
  legend,
  value,
  options,
  onChange,
}: ChoiceListProps<T>) {
  const name = useId();
  return (
    <fieldset className="choices">
      <legend>{legend}</legend>
      {options.map((option) => (
        <label className="choice" key={option.value}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          <span>
            <span className="choice__label">{option.label}</span>
            {option.hint && <span className="choice__hint">{option.hint}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
