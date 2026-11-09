import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

// Main & preload intentionally bundle ALL JS dependencies (effect, …) into
// the output — only "electron" stays external. This makes the packaged app
// self-contained and it doesn't need node_modules at runtime.
export default defineConfig({
  main: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        external: ["electron"],
        input: { index: resolve("src/desktop/main/index.ts") },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        external: ["electron"],
        input: { index: resolve("src/desktop/preload/index.ts") },
        output: { format: "cjs", entryFileNames: "index.cjs" },
      },
    },
  },
  renderer: {
    root: resolve("src/desktop/renderer"),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve("src/desktop/renderer/index.html") },
      },
    },
  },
});
