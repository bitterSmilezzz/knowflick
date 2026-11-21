import { StrictMode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { inShell } from "./shell/store";
import { makeMaterial } from "./ui/workspace/model";
import { storeMaterial } from "./ui/workspace/repository";
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
      {isCapsule ? (
        <CapsuleWindow
          saveCapture={(text) => storeMaterial(makeMaterial({ text, title: "", url: "" }), "")}
          hide={inShell() ? () => invoke("hide_capsule") : undefined}
          shortcut={/Mac|iPhone|iPad/.test(navigator.platform) ? "Option+Space" : "Alt+Space"}
        />
      ) : <Workspace />}
    </ErrorBoundary>
  </StrictMode>,
);
