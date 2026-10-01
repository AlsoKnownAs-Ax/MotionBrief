# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Native, installed desktop app (Windows x64, macOS arm64), not a website. It is built with Electron, so the UI code is HTML/CSS and the value above is `web` only to pick the right tooling. Design it as a desktop app: its own window and title bar, app and context menus, keyboard shortcuts, native file dialogs and drag-and-drop with the OS, and offline-first behaviour. Avoid web-page patterns such as page scrolling layouts, marketing headers, link-style navigation and URL routes.

## Stack

Decided in ADR 0001 and Grilling: Desktop stack (#9): Electron + React/TypeScript/Vite, Tailwind + shadcn. The core runs in a utilityProcess and talks to the UI via oRPC over MessagePort. Videos are HyperFrames (HTML/CSS/GSAP) compositions, previewed in `<hyperframes-player>` and exported by a pinned chrome-headless-shell.

## Users

Solo tech explainer creators: developers and engineers who make YouTube explainers and Shorts about software topics. They can record a Voiceover but lack the time or motion-design skill to animate it. They are technical, comfortable with Claude accounts or API keys, and judge output against creators like ByteMonk (diagram-heavy explainers) and Jamie Fenn (smooth, seamless motion).

## Product Purpose

MotionBrief is an agentic video editor: it turns a spoken recording into a motion-graphics YouTube video, generated and revised by an AI agent rather than edited by hand. Success is a complete, publishable MP4 in the chosen Style Preset and Format (9:16 or 16:9), with every element landing on the word that introduces it, without the user ever touching a timeline.

## Positioning

- **Voiceover in, motion graphics out.** Diagrams, flows, code and other Scenes are built from what the creator says, each element revealed on its spoken word. No footage, no timeline.
- **Revise by prompting.** Changes are Revisions scoped to selected Scenes, with Versions as the only undo. There is no manual editing.
- **Local, open source, your own Claude.** MIT desktop app with no backend and no telemetry. It runs on the user's Claude subscription login or API key, and a Project is a plain folder they can see, move and share.
- **Consistent, checkable output.** A validated Storyboard, per-Scene code checked by lint, contract and visual review, and Style Presets give repeatable quality. Generation always finishes with a complete video; Scenes that fail fall back and are flagged.

## Operating Context

- Flow: first-run setup (Connect Claude, background Whisper model download; non-blocking, with a Home checklist) → New Project (drop a Voiceover, pick Format, Style Preset, language) → local transcription → optional word fixes in the Transcript → user-triggered Generate → progressive preview → Revisions → MP4 export.
- Generation is slow and paid: roughly 7–9 minutes and $3–5 per minute of video with default models. An always-visible usage panel with Stop is part of the core loop; cost approval and a $ cap apply to API-key users only.
- Projects autosave to `Documents/MotionBrief/<name>/`; there is no Save button.
- Domain language is fixed in `CONTEXT.md` (Project, Voiceover, Transcript, Style Preset, Palette, Motion, Format, Storyboard, Scene, Scene Type, Canvas, Transition, Captions, Revision, Version). UI copy uses these terms and avoids the listed synonyms.

## Capabilities and Constraints

- 9 v1 Scene Types: hook, key term, architecture diagram, flow, code, comparison, list, stat/chart, outro. Same types in both Formats, re-laid-out.
- Four v1 Style Presets: Blueprint (default), Whiteboard, Sketchbook, Terminal. The Style panel swaps Palette and typography without the agent; Motion or direction changes regenerate and always confirm.
- Captions default on in vertical only. Audio is the Voiceover only.
- One connector (Claude via the Agent SDK) in v1, with a model setting per agent role.
- Any FFmpeg-readable Voiceover; language auto-detected, English is the only tested language.
- No sample Voiceover or sample video ships; the bundled Presets act as previews in the Style picker.
- Out of scope for v1: manual timeline editing, user footage, text-to-speech or text-only input, a sound/asset library, additional connectors, macOS Intel and Windows arm64.
- Open: the in-preview layout is being prototyped in Prototype: Preview UX (#19).

## Brand Commitments

- Name: MotionBrief. Open source under MIT.
- Honest about the Claude subscription caveat: the subscription card carries a permanent note that Anthropic hasn't confirmed third-party use and that an API key is the supported path.

## Evidence on Hand

- Spike results (Prototype: Voiceover to video spike, #7): 4 end-to-end runs, 1.3% fallback Scenes. Rendered videos and review stills in `prototypes/voiceover-to-video/runs/code-better/`.
- All four Style Presets passed lint, check and the anchor contract in a zero-cost look check (#14).
- No users, testimonials, customers, press, or public release yet. Do not fabricate any.

## Product Principles

1. **The video is always finished.** Every generation ends in a complete, exportable video; failures degrade to flagged fallbacks, never to a dead end.
2. **The agent edits; the user directs.** Control comes from selecting Scenes and prompting, plus no-agent swaps for style. Never reintroduce a timeline.
3. **Cost and time are visible.** Generation spends the user's money or plan limits, so progress, usage and Stop are always in reach.
4. **The user owns everything.** Local files, their own Claude account, no backend, no telemetry.
5. **Consistency over spectacle.** Structure is validated and checkable; quality is repeatable, not lucky.

## Accessibility & Inclusion

WCAG 2.2 AA for the app UI: contrast, full keyboard operation, screen-reader labels, and respect for reduced-motion in the app chrome. The generated videos follow their Style Preset; the Preset editor's contrast checks distinguish fill from text use.
