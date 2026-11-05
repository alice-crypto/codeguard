import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

interface ConfirmRequest {
  title: string;
  body: string;
  action: string;
  danger?: boolean;
}

type Confirm = (request: ConfirmRequest) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<Confirm>((next) => {
    setRequest(next);
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const finish = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setRequest(null);
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Dialog open={request !== null} title={request?.title} onClose={() => finish(false)}>
        <p>{request?.body}</p>
        <div className="dialog__actions">
          <Button onClick={() => finish(false)}>Annuler</Button>
          <Button variant={request?.danger ? "danger" : "primary"} onClick={() => finish(true)}>
            {request?.action}
          </Button>
        </div>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm doit être utilisé dans ConfirmProvider");
  return confirm;
}
