import type { ButtonHTMLAttributes } from "react";
import { useFx } from "../fx/useFx";
import { cx } from "../lib/cx";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  small?: boolean;
  wide?: boolean;
}

export function buttonClass(variant: ButtonVariant, small = false, wide = false): string {
  return cx(
    "button",
    `button--${variant}`,
    small && "button--small",
    wide && "button--wide",
  );
}

export function Button({
  variant = "secondary",
  small,
  wide,
  className,
  type = "button",
  ...props
}: ButtonProps) {
  const ref = useFx<HTMLButtonElement>();
  return (
    <button
      ref={ref}
      type={type}
      // press-squash : à éviter sur les éléments très larges, d'après sa fiche.
      data-fx={variant === "primary" && !wide ? "press-squash" : undefined}
      className={cx(buttonClass(variant, small, wide), className)}
      {...props}
    />
  );
}
