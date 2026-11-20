import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: fileURLToPath(new URL("../../workbench-go/assets/dist", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: { external: ["/wails/runtime.js"] },
  },
});
