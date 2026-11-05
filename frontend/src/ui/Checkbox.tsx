import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import "./Checkbox.css";

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  hint?: ReactNode;
  children: ReactNode;
}

export function Checkbox({ checked, onChange, disabled, hint, children }: CheckboxProps) {
  return (
    <label className={cx("checkbox", disabled && "checkbox--disabled")}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        {children}
        {hint && <span className="checkbox__hint">{hint}</span>}
      </span>
    </label>
  );
}
