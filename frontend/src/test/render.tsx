import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { createQueryClient } from "../api/queryClient";
import { ConfirmProvider } from "../ui/confirm";
import { ToastProvider } from "../ui/toast";

export function renderWithProviders(element: ReactElement) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider>
        <ConfirmProvider>{element}</ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
