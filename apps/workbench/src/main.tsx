import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Workspace } from "./ui/workspace/Workspace";
import { CapsuleWindow } from "./ui/workspace/CapsuleWindow";
import { ErrorBoundary } from "./ui/ErrorBoundary";

const isCapsule =
  typeof window !== "undefined" &&
  (window.location.hash === "#capture-capsule" ||
    window.location.search.includes("window=capsule"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      {isCapsule ? <CapsuleWindow /> : <Workspace />}
    </ErrorBoundary>
  </StrictMode>,
);
