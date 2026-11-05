import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import "./Banner.css";

type BannerTone = "error" | "warning" | "success" | "info";

const ICONS: Record<BannerTone, IconName> = {
  error: "alert",
  warning: "alert",
  success: "check",
  info: "arrow",
};

interface BannerProps {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
}

export function Banner({ tone = "info", title, children }: BannerProps) {
  return (
    <div className={`banner banner--${tone}`} role={tone === "error" ? "alert" : undefined}>
      <Icon name={ICONS[tone]} />
      <div>
        {title && <p className="banner__title">{title}</p>}
        {children}
      </div>
    </div>
  );
}
