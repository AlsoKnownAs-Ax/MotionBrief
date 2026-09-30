# PROTOTYPE findings: Voiceover to video spike

Throwaway spike for [Prototype: Voiceover to video spike](https://github.com/AlsoKnownAs-Ax/MotionBrief/issues/7). It tests the generation form from ADR 0003: a Storyboard, then code for each Scene. This is not production code.

**Question:** does the form hold up end to end, with consistent results in the chosen style?
**Verdict:** yes. Four runs (2 Voiceovers × 2 Formats) all finished with complete videos. The human verdict on motion and pacing: "feels right".

## Setup

- **Voiceovers:** synthetic, made with Piper TTS (`en_US-ryan-high`, length_scale 0.85 ≈ 184–192 wpm). The Scripts are `scripts/cdn.md` (technical, 72 s) and `scripts/code-better.md` (motivational, 162 s). Voiceover quality is the user's responsibility, not the app's.
- **Transcript:** whisper.cpp v1.9.4 (`b5130`, BLAS, CPU), large-v3-turbo q5_0, `-dtw large.v3.turbo`. It ran at 6× realtime on a Ryzen 7 9800X3D.
- **Agents:** Claude Agent SDK 0.3.285 on the existing Claude Code login, Opus 5.5, effort high (visual review: medium). Every call uses structured output (JSON schema). No tools, except Read for the reviewer.
- **Renderer:** HyperFrames 0.8.97, with its CLI `lint`/`check`/`render` and `createFileServer` + chrome-headless-shell for our own contract probe.
- **Style:** one hard-coded ByteMonk-like dark style (`src/frame.ts` `STYLE`).

## Results

| Run | Length | Scenes / units / Canvases | Storyboard attempts | Units retried | Fallbacks | Review flagged | Wall-clock | Est. cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CDN horizontal | 72 s | 12 / 11 / 1 | 1 | 2 | 0 | 9 of 11 (icon bug) | 675 s | $4.78 |
| CDN vertical* | 72 s | 15 / 11 / 3 | 1 | 3 | 0 | 8 of 11 | 1457 s | $6.41 |
| code-better horizontal* | 162 s | 27 / 23 / 4 | 1 | 4 | 3 (1 real) | 8 of 20 | 1099 s | $8.04 |
| code-better vertical* | 162 s | 38 / 34 / 4 | 2 | 3 | 0 | 16 of 34 | 1477 s | $10.39 |

\*These three ran at the same time on one machine, so their wall-clock times are inflated. Costs are the SDK's API-price estimates; on a subscription login they come out of quota instead.

**Per minute of video:**
- Cost is **$3.0–5.3**.
- Wall-clock is **7–9 min** when a run is alone; the contended runs read 9–20 min.
- Scene code and visual review take most of the time. Render is about 1 min per minute of video (screenshot capture on Windows).

**Where the cost goes:**
- Storyboard: 2–8%.
- Scene code: 45–60%.
- Visual review plus the repairs it triggers: **30–45%**.
- Hence the decision to run the reviewer on a cheaper model; see Decisions below.

## What broke, and what needs more constraint

1. **DTW word timing clusters.** 6–9% of word onsets stacked on one timestamp, typically right after a pause. We spread each stacked run over the gap to the next onset, weighted by word length. Needed in production. The Transcriber interface should own this.
2. **"Visible within 100 ms of the anchor" was unachievable as first specified.** A smooth `power3.out` reveal of 0.5–0.6 s reaches 50% opacity only about 0.12–0.25 s in. Tuned contract:
   - The element is *clearly arriving* (effective opacity ≥ 0.3, inside the frame) by anchor + 0.1 s.
   - It is *not* visible before anchor − 0.3 s.
   - `MB.reveal` starts 50 ms early, so the element lands on the word.
3. **DOM ids must be `<sceneId>-<elementId>`, not the bare Storyboard id.** HyperFrames needs ids that are unique across the assembled page, and Canvases put several Scenes in one DOM. This amends ADR 0003's "Storyboard ids as DOM ids".
4. **Connectors (lines between elements).** Hand-computed SVG coordinates end up detached from their nodes. This was the most common review finding. Two rules fixed it:
   - The frame provides `MB.connect(path, from, to)`, which measures layout while ignoring transforms.
   - The prompt requires it for every line.
5. **The contract probe must understand stroke draw-on.** A straight connector has a bbox of about 0 px, and an undrawn path is at full opacity. The first probe produced 2 false fallbacks; fixed.
6. **Map every `check` finding to its unit.** The finding reports its unit's file as `sourceFile`. Unmapped, a real overlap never went back to the agent. Deliberate layering (flip or stack effects) needs `data-layout-allow-overlap`, and the prompt now says so.
7. **Frame bugs are ours.** The icon inliner stripped `width`/`height` from inner `<rect>`s, which broke Lucide `server`. The visual reviewer caught it in 9 of 11 units. The frame needs its own tests.
8. **Vertical: on-screen copy repeats the Captions.** Example: the Scene shows "before a single byte renders" while the Captions say "byte renders.". When Captions are on, the Storyboard prompt must keep on-screen copy to labels, numbers and single hero words.
9. **Images or icons occasionally overlap and look weird** (human review). Of the review flags, overlap and alignment were the most common after connectors.
10. **Storyboard validation earns its keep.** One Storyboard of 5 anchored an element outside its Scene's words; the validator caught it and the second attempt passed. Schema plus semantic checks (tiling, boundaries, pacing, icons that exist) with feedback converged within 2 attempts.
11. **Visual repairs can break the checks.** 4 repairs broke lint or the contract and were reverted to the pre-repair code. Keep "revert on regression".
12. **Carry-over Transition: not exercised.** Its morph across two sub-compositions is still unbuilt. Everything else ran: cut, crossfade, push, zoom-through, and the Canvas camera.

## Prompting and reference examples that made it reliable

- **Structured output for everything.** The Scene agent returns `{css, html, js}` and our code wraps it: `<template>`, root, background clip, the paused timeline, registration. This removed a whole class of HyperFrames structural errors; no run had a template, registration or root-styling error.
- **The frame's `MB.*` helpers:** `reveal`, `connect`, `draw`, `travel`, `countUp`, `type`, `emphasize`, plus `MB.camera`, which our code owns. The agent writes only `at("s03-origin")`, never seconds.
- **HyperFrames' motion doctrine, restated in the prompt:** power3 by default, no bounce, reveal on the word, no breathing or drift, no exits. Our Transitions are the exit.
- **Exact anchor times plus the Scene's spoken words with times** in each Scene prompt. The storyboard's one-line `intent` gave strong, varied designs: world maps, calendars, a globe of PoPs.
- **No reference example for each Scene Type was needed** for this quality level. The frame, the doctrine and the contract were enough. Examples remain an option if consistency across Scenes drifts.

## Tuned values

| Knob | Value |
| --- | --- |
| Pacing, horizontal | Scenes 3–10 s (hard max 10); measured average 6.0 s, range 3.4–9.6 |
| Pacing, vertical | Scenes 2.5–7 s (hard max 7); measured average 4.3–4.9 s, range 2.2–7.4 |
| Scene lead | A Scene starts 0.25 s before its first word |
| Anchor tolerance | Arriving (opacity ≥ 0.3) by anchor + 0.1 s; hidden before anchor − 0.3 s; reveals start 50 ms early |
| Contract retries | 2. 12 of 79 units needed a retry and 11 passed after retries. The real fallback rate was 1 of 79 units (1.3%). |
| Storyboard retries | Up to 3; runs needed 1–2 |
| Visual review | 1 review plus 1 repair pass per unit; revert on regression |
| Subagent concurrency | 4 at a time. On one machine, running 3 videos at once (12 agents) roughly doubled time per unit. |
| Transition durations | crossfade 0.5 s, push 0.55 s, zoom-through 0.45 s, camera move 0.9 s |

## Decisions from this ticket

- **Model for each role (app setting).** Each agent role gets its own model:
  - Storyboard and Scene code (heavy reasoning): **Opus 5.5** by default.
  - Visual review: **Sonnet 5.5** by default, since review plus repair is 30–45% of cost.
  - The user can change these in a setting.

## Run it

```
cd prototypes/voiceover-to-video && npm i
# .tools/: piper + voice, whisper-cli + ggml-large-v3-turbo-q5_0.bin (see the git history of this branch)
node src/tts.ts scripts/cdn.md runs/cdn/audio
node src/transcribe.ts runs/cdn
node src/pipeline.ts cdn horizontal --tag r1        # --fallback-only, --no-review, --reuse-storyboard, --reuse-code
```
