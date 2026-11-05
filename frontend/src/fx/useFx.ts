import { useLayoutEffect, useRef } from "react";

export function useFx<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (parent) window.FX?.init(parent);
  }, []);
  return ref;
}
