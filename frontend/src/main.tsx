import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createQueryClient } from "./api/queryClient";
import { App } from "./App";
import { PreferencesProvider } from "./features/preferences/PreferencesProvider";
import { ProjectProvider } from "./features/project/ProjectProvider";
import "./styles/index.css";
import { ConfirmProvider } from "./ui/confirm";
import { ToastProvider } from "./ui/toast";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Point de montage #root introuvable");
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={createQueryClient()}>
      <PreferencesProvider>
        <ToastProvider>
          <ConfirmProvider>
            <ProjectProvider>
              <App />
            </ProjectProvider>
          </ConfirmProvider>
        </ToastProvider>
      </PreferencesProvider>
    </QueryClientProvider>
  </StrictMode>,
);
