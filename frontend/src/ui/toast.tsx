import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useFx } from "../fx/useFx";

type Notify = (message: string) => void;

const ToastContext = createContext<Notify | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const region = useFx<HTMLDivElement>();
  const notify = useCallback<Notify>(
    (message) => {
      const element = region.current;
      if (!element) return;
      element.dataset.fxMessage = message;
      window.FX?.trigger(element);
    },
    [region],
  );

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
