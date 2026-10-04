import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { bundledPackages } from "./scripts/release/bundled-packages";

export default defineConfig({
  main: {
    plugins: [bundledPackages("main")],
  },
  preload: {
    plugins: [bundledPackages("preload")],
    // Sandboxed preloads must be CommonJS.
    build: { rollupOptions: { output: { format: "cjs" } } },
  },
  renderer: {
    plugins: [react(), tailwindcss(), bundledPackages("renderer")],
    resolve: {
      alias: { "@renderer": resolve(import.meta.dirname, "src/renderer/src") },
    },
  },
});
