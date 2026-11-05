import type { ReactNode } from "react";
import { Link } from "react-router";
import { buttonClass, type ButtonVariant } from "./Button";

interface LinkButtonProps {
  to: string;
  variant?: ButtonVariant;
  small?: boolean;
  children: ReactNode;
}

export function LinkButton({ to, variant = "secondary", small, children }: LinkButtonProps) {
  return (
    <Link to={to} className={buttonClass(variant, small)}>
      {children}
    </Link>
  );
}
