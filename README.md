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

| Command                          | What it does                                                   |
| -------------------------------- | -------------------------------------------------------------- |
| `pnpm dev`                       | Runs the app with hot reload                                   |
| `pnpm build`                     | Builds main, preload, core and renderer into `out/`            |
| `pnpm start`                     | Runs the built app                                             |
| `pnpm lint`                      | ESLint, including the module boundary rules                    |
| `pnpm typecheck`                 | TypeScript for the main/core, preload, renderer and scripts    |
| `pnpm test`                      | Vitest; calls the core API in Node, without Electron, and runs the frame in the pinned chrome-headless-shell, so it needs the native dependencies below |
| `pnpm deps:fetch`                | Fetches the pinned native binaries again (below)               |
| `pnpm deps:pin <name> <version>` | Re-pins a native dependency in `deps.json` (below)             |

## Native dependencies

[`deps.json`](deps.json) pins every native dependency MotionBrief runs to the app release: its version, an immutable URL and a SHA-256 we computed ourselves (ADR 0002). `pnpm install` fetches the binaries for your platform into the gitignored `vendor/` folder and fails on any hash mismatch. It only fetches what changed, so it's quick after the first time. Set `MOTIONBRIEF_SKIP_DEPS=1` to skip it. Only Windows x64 and macOS arm64 have binaries; on other platforms the step does nothing.

pnpm skips `postinstall` when the lockfile hasn't changed, so after pulling a new `deps.json`, or after a failed fetch, run `pnpm deps:fetch`.

HyperFrames, GSAP, the bundled icon sets (Lucide, Simple Icons) and the frame's OFL fonts are npm packages pinned in `package.json`. Puppeteer never downloads a Chrome of its own (`pnpm-workspace.yaml` denies its build script): the frame and the Checker run the `chrome-headless-shell` below, with HyperFrames telemetry and update checks off.

| Name                    | Version is                           | Comes from                                                                                         |
| ----------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `chrome-headless-shell` | a Chrome for Testing version         | Chrome for Testing; use the version the pinned Puppeteer expects                                   |
| `ffmpeg`, `whisper-cli` | a `native-deps-<n>` release tag      | our [native-deps](native-deps/README.md) GitHub Release                                            |
| `claude`                | the Agent SDK version                | the SDK's per-platform npm package: pnpm installs it, and `postinstall` checks the binary's hash  |
| `whisper-model`         | a Hugging Face commit of whisper.cpp | `ggml-large-v3-turbo-q5_0.bin`; the app downloads it during first-run setup, `postinstall` doesn't |

`pnpm deps:pin <name> <version>` downloads the dependency for every platform, hashes it and rewrites its entry. Pinning `claude` also sets the Agent SDK in `package.json` to that version; run `pnpm install` after it.

## Layout

```
scripts/       Scripts that run on Node directly; deps/ fetches and pins the native dependencies
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
