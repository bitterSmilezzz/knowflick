import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Workspace } from "./ui/workspace/Workspace";
import { ErrorBoundary } from "./ui/ErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <Workspace />
    </ErrorBoundary>
  </StrictMode>,
);
