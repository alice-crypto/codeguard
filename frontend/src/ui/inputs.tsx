import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cx } from "../lib/cx";
import "./inputs.css";

interface CodeOption {
  code?: boolean;
}

export function TextInput({
  code,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & CodeOption) {
  return (
    <input
      autoComplete="off"
      spellCheck={code ? false : undefined}
      className={cx("input", code && "input--code", className)}
      {...props}
    />
  );
}

export function TextArea({
  code,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & CodeOption) {
  return (
    <textarea
      spellCheck={code ? false : undefined}
      className={cx("input", code && "input--code", className)}
      {...props}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx("input", className)} {...props} />;
}
