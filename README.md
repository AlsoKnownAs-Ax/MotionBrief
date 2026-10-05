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
| `pnpm package`                   | Builds and packs installers for this platform into `dist/` (below) |
| `pnpm package:smoke`             | Runs the app `pnpm package` packed, against the core's fixtures |

## Native dependencies

[`deps.json`](deps.json) pins every native dependency MotionBrief runs to the app release: its version, an immutable URL and a SHA-256 we computed ourselves (ADR 0002). `pnpm install` fetches the binaries for your platform into the gitignored `vendor/` folder and fails on any hash mismatch. It only fetches what changed, so it's quick after the first time. Set `MOTIONBRIEF_SKIP_DEPS=1` to skip it. Only Windows x64 and macOS arm64 have binaries; on other platforms the step does nothing.

pnpm skips `postinstall` when the lockfile hasn't changed, so after pulling a new `deps.json`, or after a failed fetch, run `pnpm deps:fetch`.

HyperFrames, GSAP, the bundled icon sets (Lucide, Simple Icons) and the frame's OFL fonts are npm packages pinned in `package.json`. Puppeteer is locked to one version (`pnpm-workspace.yaml` overrides) and never downloads a Chrome of its own (its build script is denied, `package.json` sets `skipDownload` and CI installs with `PUPPETEER_SKIP_DOWNLOAD=1`): the frame, the Checker and Export MP4 (`@hyperframes/producer`, encoding with the pinned FFmpeg) run the `chrome-headless-shell` below, with HyperFrames telemetry and update checks off.

| Name                    | Version is                           | Comes from                                                                                         |
| ----------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `chrome-headless-shell` | a Chrome for Testing version         | Chrome for Testing; use the version the pinned Puppeteer expects                                   |
| `ffmpeg`, `whisper-cli` | a `native-deps-<n>` release tag      | our [native-deps](native-deps/README.md) GitHub Release                                            |
| `claude`                | the Agent SDK version                | the SDK's per-platform npm package: pnpm installs it, and `postinstall` checks the binary's hash  |
| `whisper-model`         | a Hugging Face commit of whisper.cpp | `ggml-large-v3-turbo-q5_0.bin`; the app downloads it during first-run setup, `postinstall` doesn't |
| `whisper-vad-model`     | a Hugging Face commit of whisper-vad | `ggml-silero-v6.2.0.bin`, the VAD model whisper-cli needs; under 1 MB, so it ships with the app    |

`pnpm deps:pin <name> <version>` downloads the dependency for every platform, hashes it and rewrites its entry. Pinning `claude` also sets the Agent SDK in `package.json` to that version; run `pnpm install` after it.

## Packaging and releases

`pnpm package` builds the app, writes the license texts it ships (`scripts/release/licenses.ts`) and runs electron-builder ([`electron-builder.yml`](electron-builder.yml)): a per-user NSIS installer on Windows x64, a DMG and the updater's zip on macOS arm64, each built on its own OS. Every executable (`vendor/` and the `claude` binary) is unpacked from `app.asar`, and electron-builder refuses to pack a `vendor/` that doesn't match `deps.json`. `pnpm package:smoke` then runs the packed app's core, Checker, Export MP4 and bundled binaries.

Pushing a `vX.Y.Z` or `vX.Y.Z-beta.N` tag runs the [release workflow](.github/workflows/release.yml) on `macos-15` and `windows-2025`. It packs and smoke-tests both platforms and leaves a draft GitHub Release with the installers, the updater files and blockmaps, `LICENSE.txt`, the third-party notices, the GPL, Chromium's licenses, the FFmpeg and whisper-cli source and build scripts from the native-deps release, and `SHA256SUMS.txt`. Publishing the draft ships it. Beta tags become pre-releases, which only installs on the beta update channel (Settings) take. Installed apps download updates in the background, and only the changed blocks when they can. They then offer "Restart to update", which waits while an export runs, or install on the next quit. Code signing waits for the release gate.

## Layout

```
scripts/       Scripts that run on Node directly; deps/ fetches and pins the native dependencies, release/ packs the app
src/
  main/        Electron main: windows, menus, single-instance lock, core process lifecycle
  preload/     The bridge exposed to the renderer as window.motionbrief
  renderer/    React UI (Tailwind + shadcn/ui), a client of the core API
  core/        Entry of the core utilityProcess and the composition root
  modules/     Product logic, one folder per module, each with one public index.ts
  contract/    The core API contract (oRPC + zod), shared by the core and the UI
  shared/      Constants shared by main, preload and renderer, and the deps.json schema scripts/ and the core share
```

The UI talks to the core over typed oRPC on a MessagePort the renderer hands, through main, to a single `utilityProcess` that runs every module. If that process dies, main restarts it and the window reconnects. Modules never import Electron or UI code, so tests drive the core API in plain Node through `createCore` in `src/core/composition-root.ts`, swapping adapters where needed. `eslint-plugin-boundaries` enforces this.
