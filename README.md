# MotionBrief

An agentic video editor: it turns a spoken recording into a motion-graphics YouTube video, generated and revised by an AI agent rather than edited by hand. Native desktop app for Windows x64 and macOS arm64, MIT-licensed.

Domain language is in [`CONTEXT.md`](CONTEXT.md), decisions in [`docs/adr/`](docs/adr/), the visual language in [`DESIGN.md`](DESIGN.md).

## Development

Requires the Node version in [`.node-version`](.node-version). pnpm is pinned in `package.json` and provided by Corepack:

```sh
corepack enable
pnpm install
pnpm dev
```

| Command          | What it does                                                   |
| ---------------- | -------------------------------------------------------------- |
| `pnpm dev`       | Runs the app with hot reload                                   |
| `pnpm build`     | Builds main, preload, core and renderer into `out/`            |
| `pnpm start`     | Runs the built app                                             |
| `pnpm lint`      | ESLint, including the module boundary rules                    |
| `pnpm typecheck` | TypeScript for the main/core, preload and renderer projects    |
| `pnpm test`      | Vitest; calls the core API in Node, without Electron           |

## Layout

```
src/
  main/        Electron main: windows, menus, single-instance lock, core process lifecycle
  preload/     The bridge exposed to the renderer as window.motionbrief
  renderer/    React UI (Tailwind + shadcn/ui), a client of the core API
  core/        Entry of the core utilityProcess and the composition root
  modules/     Product logic, one folder per module, each with one public index.ts
  contract/    The core API contract (oRPC + zod), shared by the core and the UI
  shared/      Constants shared by main, preload and renderer
```

The UI talks to the core over typed oRPC on a MessagePort the renderer hands, through main, to a single `utilityProcess` that runs every module. If that process dies, main restarts it and the window reconnects. Modules never import Electron or UI code, so tests drive the core API in plain Node through `createCore` in `src/core/composition-root.ts`, swapping adapters where needed. `eslint-plugin-boundaries` enforces this.
