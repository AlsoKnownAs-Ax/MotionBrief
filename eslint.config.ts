import js from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Packages that tie code to Electron or the UI. Modules, the core and shared code must run headless without them. */
const ELECTRON_AND_UI = [
  "electron",
  "react",
  "react-dom",
  "@tanstack/*",
  "@orpc/tanstack-query",
  "zustand",
  "radix-ui",
  "lucide-react",
  "class-variance-authority",
  "clsx",
  "tailwind-merge",
  "@fontsource-variable/*",
];

const HEADLESS = ["core", "module", "contract", "shared"];

export default defineConfig([
  globalIgnores([
    "out/",
    "node_modules/",
    "vendor/",
    "prototypes/",
    ".agents/",
    ".claude/",
    ".codex/",
    ".opencode/",
    ".impeccable/",
    // Scene code fixtures are agent output, checked by the Checker rather than ESLint.
    "src/core/fixtures/",
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Scripts the frame and the Checker load into the page.
    files: ["src/modules/*/runtime/*.js"],
    languageOptions: { sourceType: "script", globals: { ...globals.browser } },
  },
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      "import/resolver": {
        typescript: { project: "tsconfig.json" },
      },
      "boundaries/elements": [
        { type: "main", pattern: "src/main", partialMatch: false },
        { type: "preload", pattern: "src/preload", partialMatch: false },
        { type: "renderer", pattern: "src/renderer", partialMatch: false },
        { type: "core", pattern: "src/core", partialMatch: false },
        { type: "module", pattern: "src/modules/*", partialMatch: false, capture: ["name"] },
        { type: "contract", pattern: "src/contract", partialMatch: false },
        { type: "shared", pattern: "src/shared", partialMatch: false },
      ],
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          checkAllOrigins: true,
          policies: [
            // Packages and Node built-ins are allowed unless a later policy says otherwise.
            { allow: { to: { module: { origin: ["external", "core"] } } } },
            {
              from: { element: { type: "main" } },
              allow: [
                { to: { element: { type: "shared" } } },
                // `?modulePath` yields the core entry's built path for utilityProcess.fork, not its code.
                { to: { element: { type: "core", fileInternalPath: "index.ts" } } },
              ],
            },
            { from: { element: { type: "preload" } }, allow: { to: { element: { type: "shared" } } } },
            {
              from: { element: { type: "renderer" } },
              allow: [
                { to: { element: { type: ["contract", "shared"] } } },
                // The renderer may know the preload bridge's shape, never its code.
                { to: { element: { type: "preload" } }, dependency: { kind: "type" } },
              ],
            },
            {
              from: { element: { type: ["core", "module"] } },
              allow: [
                { to: { element: { type: ["contract", "shared"] } } },
                // A module is reached only through its public entry: no deep imports.
                { to: { element: { type: "module", fileInternalPath: "index.ts" } } },
              ],
            },
            { from: { element: { type: "contract" } }, allow: { to: { element: { type: "shared" } } } },
            {
              from: { element: { type: HEADLESS } },
              disallow: { to: { module: { origin: "external", source: ELECTRON_AND_UI } } },
              message: "{{from.element.types.[0]}} code must run headless: no Electron or UI imports ({{to.module.source}}).",
            },
            {
              from: { element: { type: "renderer" } },
              disallow: [{ to: { module: { origin: "core" } } }, { to: { module: { origin: "external", source: "electron" } } }],
              message: "The renderer reaches Node and Electron only through the preload bridge and the core API.",
            },
          ],
        },
      ],
    },
  },
]);
