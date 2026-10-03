import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

export default defineConfig({
  main: {},
  preload: {
    // Sandboxed preloads must be CommonJS.
    build: { rollupOptions: { output: { format: "cjs" } } },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@renderer": resolve(import.meta.dirname, "src/renderer/src") },
    },
  },
});
