# Electron shell with a TypeScript core

MotionBrief is an Electron app whose product logic is written in TypeScript, not a Tauri app and not a Rust backend. The video is an HTML composition (HyperFrames) exported by Chrome, so previewing it in Electron's bundled Chromium keeps preview and export on the same engine; Tauri would preview in WebKit on macOS while exporting in Chrome. The agent SDK (Claude Agent SDK) and the renderer (HyperFrames producer) are Node-only, so a Rust core would mostly wrap Node subprocesses, adding a second language and runtime for contributors without moving any heavy work (frame drawing is Chrome, encoding is FFmpeg).

## Considered Options

- **Tauri + Node sidecar**: smaller shell, but Node and Chromium must ship anyway for the agent and export, so the size win mostly vanishes, and macOS preview diverges from export (text metrics, filters, blend modes, codecs, fonts).
- **Rust core / Rust renderer**: would mean reimplementing the HyperFrames producer and relying on unofficial Rust agent SDKs. Left open as a later swap behind the Renderer module's interface if a benchmark ever shows orchestration is the bottleneck.

## Consequences

- Export still ships its own pinned chrome-headless-shell (~100 MB): the HyperFrames producer only launches browsers it owns, and Electron can't be driven that way (no `Target.createTarget`). Pick the Electron release whose Chromium major is closest to the pinned headless shell so preview and export stay within a version or two.
