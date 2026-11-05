import { useEffect, useRef, type RefObject } from "react";
import { useLocation } from "react-router";

export function useRouteFocus(main: RefObject<HTMLElement | null>) {
  const { pathname } = useLocation();
  const previous = useRef(pathname);

  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    window.scrollTo(0, 0);
    main.current?.focus({ preventScroll: true });
  }, [pathname, main]);
}
