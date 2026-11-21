import { fileURLToPath } from "node:url";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: {
      // 共享前端仍按 Tauri 方式调用原生；在 Wails 预览里换成兼容层。
      "@tauri-apps/api/core": path.resolve(fileURLToPath(new URL("./tauriCoreShim.ts", import.meta.url))),
      "@tauri-apps/api/app": path.resolve(fileURLToPath(new URL("./tauriAppShim.ts", import.meta.url))),
    },
  },
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: fileURLToPath(new URL("../../workbench-go/assets/dist", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: { external: ["/wails/runtime.js"] },
  },
});