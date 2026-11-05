import { createContext, useCallback, useContext, useRef, type ReactNode } from "react";
import { useFx } from "../fx/useFx";

type Notify = (message: string) => void;

const ToastContext = createContext<Notify | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const region = useFx<HTMLDivElement>();
  const latest = useRef(region);
  const notify = useCallback<Notify>((message) => {
    const element = latest.current.current;
    if (!element) return;
    element.dataset.fxMessage = message;
    window.FX?.trigger(element);
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div ref={region} data-fx="toast" />
    </ToastContext.Provider>
  );
}

export function useToast(): Notify {
  const notify = useContext(ToastContext);
  if (!notify) throw new Error("useToast doit être utilisé dans ToastProvider");
  return notify;
}
