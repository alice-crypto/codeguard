import { useEffect } from "react";

export function usePageTitle(title?: string) {
  useEffect(() => {
    if (!title) return;
    document.title = `${title} · codeguard`;
    return () => {
      document.title = "codeguard";
    };
  }, [title]);
}
