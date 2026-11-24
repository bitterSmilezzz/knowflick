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
    rollupOptions: {
      external: ["/wails/runtime.js"],
      // 把 node_modules 单独成块：主包过大时让依赖部分可长期缓存（WP10 基线对比用）。
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) return "vendor";
        },
      },
    },
  },
});