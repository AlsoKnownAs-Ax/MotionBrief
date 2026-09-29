# Research: Motion-graphics rendering engine

Ticket: [#2](https://github.com/AlsoKnownAs-Ax/MotionBrief/issues/2) · Map: [#1](https://github.com/AlsoKnownAs-Ax/MotionBrief/issues/1) · Researched 2026-09-29

**Question.** Which engine should turn agent-authored motion graphics into an MP4, locally, inside a cross-platform (Windows + macOS) desktop app that is MIT-licensed? The agent (Claude Opus 5.5) writes the video from the Transcript. The user asks for Revisions in chat. The video must look right in both Formats (9:16 and 16:9) and in any Style Preset.

**Short answer.** Use **HyperFrames**, which is Apache-2.0 and built from HTML, CSS and a seekable animation runtime (GSAP by default). Render with `@hyperframes/producer`, or the CLI, from Node. Preview with `@hyperframes/player`. **Revideo** is the runner-up. Remotion is ruled out by its license. Motion Canvas, Lottie, Manim and a from-scratch renderer are each ruled out for the reasons below. It is not a close call, but two risks need a decision owner: GSAP's proprietary license, and HyperFrames being young and fast-moving (see [Risks](#risks-and-open-questions)).

All facts below were checked on 2026-09-29 against the linked primary source.

---

## 1. Candidates at a glance

| | License | Local headless render → MP4 | In-app preview / scrubbing | LLM authoring surface | Maturity (2026-09-29) |
|---|---|---|---|---|---|
| **HyperFrames** | Apache-2.0 | Yes: CLI / `@hyperframes/producer` (Puppeteer + chrome-headless-shell + FFmpeg) | Yes: `<hyperframes-player>` web component with `seek()`; Studio | HTML + CSS + paused GSAP timeline; `lint` / `check`; 21 official agent skills | Created 2026-03-10, v0.8.92, ~54k★, released several times per day |
| **Revideo** | MIT | Yes: `renderVideo()`, headless browser | Yes: React `<Player>` | TypeScript generator functions (imperative) | v0.11.0 (2026-07-10), ~4k★, repo moved to `midrender/revideo` |
| **Motion Canvas** | MIT | No headless path: rendering is a button in the editor that outputs an image sequence | Yes, in its own editor; `player` package | TypeScript generators | Last npm release 3.17.2 (2024-12-14), ~19k★ |
| **Remotion** | Proprietary "Remotion License" (source-available) | Yes: `renderMedia()`, Electron template | Yes: `<Player>` | React function of frame number | v4.0.530, ~61k★, very mature |
| **Lottie (lottie-web)** | MIT (player) | No: it is a playback format and needs a capture pipeline | Yes (player) | Bodymovin JSON, hostile to hand-authoring | lottie-web 5.13.0 (2025-05-21) |
| **Custom canvas/WebGL + FFmpeg** | Whatever we choose | Yes, but we build it | Yes, but we build it | Whatever DSL we design | n/a |
| **Manim (Community)** | MIT | Yes (Python, Cairo/OpenGL) | No live in-app scrubbing | Python scene code | ~41k★, active |

---

## 2. Each candidate against the criteria

### 2.1 HyperFrames (HeyGen)

**What it is.** "An open-source framework for turning HTML, CSS, media, and seekable animations into deterministic MP4 videos", built for AI coding agents ([README](https://github.com/heygen-com/hyperframes/blob/main/README.md)).

**License.** Apache-2.0, © 2026 HeyGen, Inc. ([LICENSE](https://github.com/heygen-com/hyperframes/blob/main/LICENSE)). The published `hyperframes` npm package also declares Apache-2.0 ([npm registry](https://registry.npmjs.org/hyperframes)). Apache-2.0 can be bundled in an MIT app. We must ship its license text and NOTICE attributions ([§4](https://github.com/heygen-com/hyperframes/blob/main/LICENSE)). HeyGen's own comparison page says: "Apache 2.0 means no seat count and no license review" ([HyperFrames or Remotion?](https://hyperframes.heygen.com/guides/hyperframes-vs-remotion.md)).
- **Caveat: GSAP.** GSAP is the default animation runtime ([Runtimes and 3D](https://hyperframes.heygen.com/llms.txt)). It is not open source. It uses Webflow's "Standard 'No Charge' GSAP License" ([gsap.com/standard-license](https://gsap.com/standard-license/)):
  - Commercial and non-commercial use is free "as long as end users are not charged a fee".
  - "Prohibited Uses" are tools "that allow users to build visual animations without code" and that compete with Webflow's visual animation builder.
  - The license FAQ says "AI-generated code is not a 'Prohibited Use'".
  - Webflow can amend the terms.

  MotionBrief is a free, chat-driven video generator, not a visual animation builder, so it appears to be a Permitted Use. However, GSAP cannot be relicensed under MIT and must ship under its own terms. HyperFrames also supports other runtimes through frame adapters: Anime.js (MIT), CSS, WAAPI, Lottie, Three.js and TypeGPU ([README, `/hyperframes-animation`](https://github.com/heygen-com/hyperframes/blob/main/README.md)). This gives us a GSAP-free fallback.

**Headless local render on Windows and macOS.**
- **Pipeline.** Puppeteer drives `chrome-headless-shell`. FFmpeg encodes and mixes audio ([@hyperframes/engine](https://hyperframes.heygen.com/packages/engine.md), [@hyperframes/producer](https://hyperframes.heygen.com/packages/producer.md)). Requirements are Node.js ≥ 22 and FFmpeg ([README badge](https://github.com/heygen-com/hyperframes/blob/main/README.md); [launch-video README](https://github.com/heygen-com/hyperframes-launch-video/blob/main/README.md)).
- **Programmatic API.** `createRenderJob()` / `executeRenderJob()` report progress and can be cancelled with an `AbortSignal`. Outputs are MP4 (H.264 + AAC), WebM, MOV, GIF, PNG sequence and HLS ([producer docs](https://hyperframes.heygen.com/packages/producer.md)).
- **Supported platforms.** The browser manager resolves `chrome-headless-shell` binaries for `darwin/arm64`, `darwin/x64`, `win32/x64` and `win32/ia32` ([browserManager.ts](https://github.com/heygen-com/hyperframes/blob/main/packages/engine/src/services/browserManager.ts)).
- **Capture method is platform-dependent.** The atomic `HeadlessExperimental.beginFrame` capture described in the [determinism docs](https://hyperframes.heygen.com/concepts/determinism.md) is used only on Linux. On macOS and Windows the engine seeks each frame and screenshots it ("screenshot" mode). A faster "drawElement" path engages only on darwin/win32 with a hardware GPU ([browserManager.ts](https://github.com/heygen-com/hyperframes/blob/main/packages/engine/src/services/browserManager.ts), [config.ts](https://github.com/heygen-com/hyperframes/blob/main/packages/engine/src/config.ts)). Frames are still seek-driven, so none are dropped ([determinism](https://hyperframes.heygen.com/concepts/determinism.md)).
- **Windows is well exercised.** Code comments cite "~206k non-CI hardware-GPU Windows renders / 30d" ([config.ts](https://github.com/heygen-com/hyperframes/blob/main/packages/engine/src/config.ts)). They also document Windows-specific workarounds, such as auto-disabling streaming encode in one failure mode.
- **Bundling cost.** We would ship Node (or Electron's Node), `chrome-headless-shell` and an FFmpeg binary. The CLI depends on `puppeteer-core` and `@puppeteer/browsers` ([npm](https://registry.npmjs.org/hyperframes)).
- **Telemetry.** The CLI sends telemetry to PostHog: command names, render performance, OS/CPU shape. It can be turned off with `HYPERFRAMES_NO_TELEMETRY=1`. The CLI reads a `HYPERFRAMES_CLIENT` tag for apps that launch it ([CLI reference, `telemetry`](https://hyperframes.heygen.com/packages/cli.md)). No account is needed to render locally ([Authentication](https://hyperframes.heygen.com/guides/authentication.md)).

**Live preview and scrubbing.**
- `@hyperframes/player` is a `<hyperframes-player>` custom element. It exposes `play()`, `pause()`, `seek(t)` and `currentTime`, supports range playback, and emits `timeupdate` events. The composition runs in a sandboxed iframe ([Player](https://hyperframes.heygen.com/packages/player.md)).
- The docs say preview and render produce the same frames because both use the same runtime and seek behaviour. Preview is real-time and can stutter; render cannot ([determinism](https://hyperframes.heygen.com/concepts/determinism.md)).
- `@hyperframes/sdk` offers typed edit operations, undo/redo and JSON patches on the composition HTML ([Developers overview](https://hyperframes.heygen.com/developers/overview.md)). This could support targeted Revisions.

**LLM authoring.**
- **Format.** Declarative timing via `data-start`, `data-duration` and `data-track-index` on `.clip` elements, plus a paused GSAP timeline registered on `window.__timelines` ([HyperFrames or Remotion?](https://hyperframes.heygen.com/guides/hyperframes-vs-remotion.md)).
- **Determinism rules.** No wall clock, no unseeded randomness, no fetching mid-render, fixed size and fps ([determinism](https://hyperframes.heygen.com/concepts/determinism.md)).
- **Error surface.** HyperFrames admits its model "breaks quietly if you don't" follow the rules ([HyperFrames or Remotion?](https://hyperframes.heygen.com/guides/hyperframes-vs-remotion.md)). The mitigations are `hyperframes lint` (structure) and `hyperframes check`, which opens a browser and looks for runtime, layout, motion, media and contrast problems ([Rendering guide](https://hyperframes.heygen.com/guides/rendering.md)).
- **Agent skills.** There are 21 official skills, including `/faceless-explainer`, whose visuals are "typography / abstract / diagram / data-viz", plus `/hyperframes-animation`, `/hyperframes-keyframes` and `/hyperframes-creative` ([README](https://github.com/heygen-com/hyperframes/blob/main/README.md)). This is the closest match to MotionBrief's Voiceover-to-explainer flow.

**Benchmark look (ByteMonk / Jamie Fenn).**
- **Explainer building blocks.** Everything the browser can draw is available: SVG path draw and morph, masks, FLIP, 3D depth ([`/hyperframes-keyframes`](https://github.com/heygen-com/hyperframes/blob/main/README.md)). So are WebGL shader transitions (`@hyperframes/shader-transitions`), a per-pixel `data-vfx-chain`, and prompting guides for code animations, charts/maps and "motion that reads premium" ([docs index](https://hyperframes.heygen.com/llms.txt)).
- **Formats.** Each composition declares `data-width`/`data-height`, so 1080×1920 and 1920×1080 are both first-class ([Developers overview](https://hyperframes.heygen.com/developers/overview.md)).
- **Production example.** HeyGen's own launch video is 1920×1080 at 30 fps, 17 sub-compositions, mixing CSS, GSAP, Lottie, shaders, Three.js and voiceover ([hyperframes-launch-video](https://github.com/heygen-com/hyperframes-launch-video/blob/main/README.md)).

**Maturity.**
- Repo created 2026-03-10; ~54k stars; 205 open issues; pushed today ([GitHub API](https://api.github.com/repos/heygen-com/hyperframes)).
- Three releases on 2026-09-29 alone, v0.8.90 to v0.8.92 ([releases](https://github.com/heygen-com/hyperframes/releases)).
- Backed by HeyGen. HeyGen concedes Remotion "is older and much more established" with "far more production history" ([HyperFrames or Remotion?](https://hyperframes.heygen.com/guides/hyperframes-vs-remotion.md)).

### 2.2 Revideo

- **What it is.** A scene is a TypeScript generator function, the same model Motion Canvas uses. The README pitches that "Claude or Codex can produce one from a prompt" ([README](https://github.com/redotvideo/revideo/blob/main/README.md)).
- **License.** MIT ([README](https://github.com/redotvideo/revideo/blob/main/README.md); [npm @revideo/core](https://registry.npmjs.org/@revideo/core)).
- **Render.** Headless `renderVideo()` "runs anywhere Node and a headless browser run", with parallelised rendering ([README](https://github.com/redotvideo/revideo/blob/main/README.md)). Its core depends on `mp4-wasm` ([npm](https://registry.npmjs.org/@revideo/core)).
- **Preview.** A React `<Player>` that renders scenes in the browser; the same project drives preview and render ([README](https://github.com/redotvideo/revideo/blob/main/README.md)).
- **Telemetry.** Anonymous render counts go to PostHog; disable with `DISABLE_TELEMETRY=true` ([README](https://github.com/redotvideo/revideo/blob/main/README.md)).
- **LLM authoring.** Imperative generator code (`yield* waitFor(...)`, `yield* node().prop(v, t)`). Output is deterministic by construction because time comes from the generator, not a wall clock. However, the model must reason in sequential time rather than laying out a declarative timeline, and there is no official linter or skill set.
- **Benchmark look.** A vector-first 2D canvas scene graph with signals and layouts. It inherits Motion Canvas's strength for "informative vector animations … synchronize[d] with voice-overs" ([Motion Canvas README](https://github.com/motion-canvas/motion-canvas/blob/main/README.md)). Its styling vocabulary is smaller than full HTML/CSS.
- **Maturity.**
  - ~4k stars. No GitHub releases; 0.11.0 on npm (2026-07-10).
  - The repo was renamed to `midrender/revideo` and last pushed 2026-07-15 ([GitHub API](https://api.github.com/repos/redotvideo/revideo)).
  - It is now "the engine behind Midrender", a single-company commercial product ([README](https://github.com/redotvideo/revideo/blob/main/README.md)).

### 2.3 Motion Canvas

- **License.** MIT ([GitHub API](https://api.github.com/repos/motion-canvas/motion-canvas)).
- **Render.** Rendering is done from the editor's Video Settings tab. It "will play through the animation and save each frame as an image", and you run FFmpeg yourself afterwards ([Rendering docs](https://motioncanvas.io/docs/rendering)). There is no documented headless or programmatic render API; Revideo's headless `renderVideo()` is the closest equivalent.
- **Preview.** Excellent in its own Vite-based editor. A `player` custom element exists ([README](https://github.com/motion-canvas/motion-canvas/blob/main/README.md)).
- **Maturity.** The last stable npm release was 3.17.2 on 2024-12-14. The latest tag is `v3.18.0-alpha.0` (2025-02-16) ([npm](https://registry.npmjs.org/@motion-canvas/core), [releases](https://github.com/motion-canvas/motion-canvas/releases)). The repo still receives pushes (2026-07-02) but releases have stalled.
- **Verdict.** Good ideas, wrong shape. We would end up re-implementing Revideo.

### 2.4 Remotion

**License: incompatible with the goals of an MIT, free-for-everyone app.**
- Remotion "is not open-source software according to the Open Source Initiative (OSI) definition … it operates under a proprietary license called the Remotion License" ([Terms v5.0, "Software license"](https://www.remotion.dev/docs/terms)).
- The Free License covers individuals, for-profit organisations with ≤ 3 people, non-profits, and evaluation. Everyone else needs a Company License ([LICENSE.md](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)).
- A "User" is "any natural or legal person that uses the Remotion Software" ([Terms](https://www.remotion.dev/docs/terms)). So if MotionBrief embedded Remotion, **any company of four or more people running MotionBrief would owe Remotion a license**. An MIT license on our code cannot waive that.
- **"Remotion for Automators"** covers "organizations building … video editors, prompt-to-video tools, automated video pipelines, embedding the Remotion Player". An automation is "owning code that calls" `renderMedia()`, `<Player>` and similar. The price is $0.01/render with a $100/month minimum ([Terms](https://www.remotion.dev/docs/terms); [License FAQ](https://www.remotion.pro/faq)). MotionBrief is exactly a prompt-to-video tool.
- It is "not allowed to copy or modify Remotion code for the purpose of selling, renting, licensing, relicensing, or sublicensing your own derivate of Remotion" ([LICENSE.md](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)).
- **Tightening in 5.0.** Contractors will count toward team size ([PR #3750](https://github.com/remotion-dev/remotion/pull/3750)). Telemetry becomes mandatory for Automators customers ([License FAQ](https://www.remotion.pro/faq)). `renderMedia()` gains a required `licenseKey: string | null` parameter in the v5 branch ([issue #9539](https://github.com/remotion-dev/remotion/issues/9539)). Client-side rendering already has "telemetry enabled by default which cannot be disabled" ([License FAQ](https://www.remotion.pro/faq)).

**Technically it is the most mature option.**
- An official, still "EXPERIMENTAL" Electron integration renders in the main process. It ships native compositor binaries unpacked from `app.asar` and downloads or bundles Chrome Headless Shell ([Using Remotion in Electron](https://www.remotion.dev/docs/electron)).
- React-per-frame is a pure function, which HeyGen also concedes is "genuinely simpler to hold in your head" ([HyperFrames or Remotion?](https://hyperframes.heygen.com/guides/hyperframes-vs-remotion.md)).
- ~61k stars and near-daily releases (v4.0.530 today) ([GitHub API](https://api.github.com/repos/remotion-dev/remotion)).

**Verdict.** Excluded on license. MotionBrief's users (any company with more than three people) would each need a paid Remotion license, which contradicts shipping an MIT app anyone can use.

### 2.5 Lottie

- **What it is.** A JSON animation format exported from After Effects (Bodymovin) plus players. `lottie-web` is MIT; its last release was 5.13.0 on 2025-05-21 and its last push 2025-09 ([npm](https://registry.npmjs.org/lottie-web); [GitHub API](https://api.github.com/repos/airbnb/lottie-web)). The format spec lives at [lottie-animation-community/lottie-spec](https://github.com/lottie-animation-community/lottie-spec).
- **Render to MP4.** It has no renderer of its own; it still needs a browser (or ThorVG/rlottie) plus a frame-capture and FFmpeg pipeline.
- **LLM authoring.** Poor. The deeply nested keyframe JSON (`ks`, `ip`/`op`, bezier tangents) is verbose and unforgiving for a model to hand-write.
- **Verdict.** Not an engine for us. It is a useful asset type inside HyperFrames, which ships a Lottie frame adapter ([README](https://github.com/heygen-com/hyperframes/blob/main/README.md)).

### 2.6 Custom canvas/WebGL + FFmpeg (or WebCodecs)

- **What we would build.** A scene DSL, a seekable runtime, a player, a frame-capture loop (Electron offscreen rendering or Puppeteer), audio mixing, and encoding via FFmpeg or WebCodecs + [Mediabunny](https://github.com/Vanilagy/mediabunny) (MPL-2.0).
- **Pros.** Full control, any license, and the smallest possible dependency surface.
- **Cons.** Months of engine work before any benchmark-quality video. HyperFrames's Apache-2.0 engine already solves the hard parts: deterministic seek, font and media readiness gates, Windows capture quirks, audio mixing, and encoder settings. We can fork it if we ever need to diverge.
- **Verdict.** Keep as an escape hatch, not a starting point.

### 2.7 Other contender considered: Manim

- MIT, ~41k stars, active ([GitHub API](https://api.github.com/repos/ManimCommunity/manim)). Excellent for 3Blue1Brown-style math diagrams.
- Python-only, which would mean bundling Python and often LaTeX.
- No embeddable live scrubbing player, and a narrower styling vocabulary than HTML/CSS. It does not match the Jamie Fenn-style UI and typography look.
- Not recommended.

---

## 3. Cross-cutting notes

- **FFmpeg licensing.** FFmpeg is LGPL-2.1+, but builds with GPL parts (e.g. `--enable-gpl` for libx264) make "all of FFmpeg" GPL ([ffmpeg.org/legal](https://ffmpeg.org/legal.html)). Every browser-capture candidate needs an encoder. The packaging ticket should choose one of:
  - an LGPL build using platform H.264 encoders (Media Foundation on Windows, VideoToolbox on macOS), or
  - a GPL build shipped as a separate executable, with its source-offer obligations.
- **Bundle size.** Every browser-based option (HyperFrames, Revideo, Remotion) needs a Chromium build for rendering. If the desktop shell is Electron, its own Chromium can host the *preview*. The *render* in HyperFrames uses a separate `chrome-headless-shell`, as Remotion's Electron guide also does for its renderer ([Remotion Electron](https://www.remotion.dev/docs/electron)).
- **Node requirement.** HyperFrames needs Node ≥ 22. This fits an Electron main process or a Node sidecar under Tauri. The shell choice is out of scope for this ticket.

---

## 4. Recommendation

**Adopt HyperFrames as MotionBrief's rendering engine.**
- **Composition format.** The agent writes HyperFrames compositions: HTML + CSS + a seekable runtime.
- **Rendering.** The app calls `@hyperframes/producer` from Node (with progress and cancel), or the CLI with `HYPERFRAMES_NO_TELEMETRY=1` and a `HYPERFRAMES_CLIENT` tag.
- **Preview.** `<hyperframes-player>` powers live preview and scrubbing.
- **Timing.** Transcript word timings map directly onto `data-start` / `data-duration` and timeline positions, in seconds.

**Why:**
1. **License.** Apache-2.0 bundles cleanly into an MIT app with no per-user or per-render obligations. Remotion's terms would bill every larger company using MotionBrief.
2. **Built for exactly this job.** Agent-authored, deterministic, seek-driven video. It comes with a linter, a browser-based checker, and official skills for faceless diagram/data-viz explainers that we can mine for our own system prompt.
3. **One source for preview and render.** Player and producer share one runtime, so what the user scrubs is what gets exported.
4. **Highest ceiling for the benchmark look.** The full web platform is available (SVG draw/morph, CSS, WebGL shader transitions, Three.js, Lottie). Both Formats are just composition dimensions.
5. **Proven on Windows and macOS.** The engine has explicit platform code paths and large Windows usage.

**Runner-up: Revideo.** Choose it if we want a fully MIT, GSAP-free, code-first stack and accept a smaller community, single-company stewardship and imperative authoring.

---

## Risks and open questions

1. **GSAP's license is proprietary.** It is free here and AI-generated code is explicitly allowed, but Webflow can amend it and bars "visual animation without code" builders. **Decision needed:** accept GSAP, or tell the agent to use Anime.js/WAAPI/CSS adapters only. The second option costs some of the official skills' recipes, which are GSAP-first.
2. **HyperFrames is six months old and moves very fast** (multiple releases per day, v0.x). Pin exact versions, vendor or fork the skills we rely on, and expect API churn.
3. **macOS/Windows capture uses screenshot mode, not BeginFrame.** Correctness is unaffected, but render speed on user machines is unmeasured. Benchmark a 3-minute 1080×1920 explainer on a mid-range Windows laptop and an Apple Silicon Mac before committing.
4. **Silent-failure authoring rules** (paused timeline, `window.__timelines` registration, no wall clock). Run `lint` + `check` in the agent's loop after every generation and Revision, and feed errors back to the model.
5. **Telemetry.** The CLI sends telemetry by default (opt-out via environment variable). Not verified: whether `@hyperframes/producer` used as a library emits any. Check before shipping, since MotionBrief should make its own privacy promise.
6. **Bundle size** of Node + `chrome-headless-shell` + FFmpeg, and the FFmpeg LGPL/GPL build choice. Hand both to the packaging/desktop-shell ticket.
