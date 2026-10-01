# PROTOTYPE findings: Style Preset range

Throwaway prototype for [Prototype: Style Preset range](https://github.com/AlsoKnownAs-Ax/MotionBrief/issues/14), built on the [voiceover-to-video spike](https://github.com/AlsoKnownAs-Ax/MotionBrief/blob/prototype/voiceover-to-video-spike/prototypes/voiceover-to-video/FINDINGS.md). Not production code; never merge.

**Question:** do the Style Preset settings from [Grilling: Style model](https://github.com/AlsoKnownAs-Ax/MotionBrief/issues/8) reach all four bundled styles, and does generation stay reliable under each one?

**Verdict (user):** the four Presets are accepted from the zero-cost look check. The agent runs for each style were deferred: Presets are data and cheap to tweak if a later run shows problems.

## What was built

- `src/preset.ts`: the Preset shape (Palette, typography, treatments, Motion, direction, allowed Transitions, Canvas preference, caption style), 6 Palettes, 4 typography pairings, the 4 bundled Presets, the Motion → helper-defaults mapping, pacing per energy, and the editor's contrast rule.
- `src/frame.ts`: the frame now reads the active Preset. Palette and type become CSS tokens, treatments become frame-owned classes, filters and overlays, and Motion sets the `MB.*` defaults.
- `src/tokens.ts`: the token-only lint (no raw hex/rgb/hsl/oklch/named colors, no font other than `var(--font-*)`). It is wired into the pipeline as a retry-feedback source.
- `src/prompts.ts` and `src/pipeline.ts`: the Storyboard, Scene-code and review prompts take the Preset (direction, Motion rules, tokens, icon and surface treatment, allowed Transitions, Canvas preference). The validator rejects disallowed Transitions and Canvases. Review runs on Sonnet 5.5. The pipeline takes `--preset`, and `--from/--palette/--type` for the swap test.
- `src/lookcheck.ts` + `src/sheet.ts` + `src/serve.ts`: a hand-written, token-only demo (architecture Scene → Transition → stat Scene, with Captions) rendered through each Preset × Format, with no agent calls.

## Results (look check)

| Preset | lint/check | Anchor contract (8 per render) | Render, ×realtime |
| --- | --- | --- | --- |
| Blueprint | 0 / 0 | 0 late, 0 early | 2.0 |
| Whiteboard | 0 / 0 | 0 late, 0 early | 1.9–2.0 |
| Sketchbook (springy) | 0 / 0 | 0 late, 0 early | 2.3 |
| Terminal (stepped, 12 fps) | 0 / 0 | 0 late, 0 early | 2.0 |

- Sketchbook's treatments (sketchy filter + paper texture) cost about **15% render time**; nothing else measurable.
- **Token-only baseline:** 95 of 102 Scene-code units from the spike would fail the lint (raw `rgba()`/hex: about 190 hits; named fonts: 67). They were written before the rule, so the rule needs both the prompt and lint feedback. The agent's compliance rate is **unmeasured**.

## What needed care (all fixed in the frame)

1. **Stepped Motion** = the frame wraps each unit's timeline in a stepped time tween (`MB.quantize`, 12 fps). It passes the anchor contract (worst-case delay 83 ms), and the agent doesn't have to do anything for it.
2. **`MB.draw` must land like `MB.reveal`:** start 50 ms early with an ease-out. Starting on the word with an in-out ease left connectors under 30% drawn at anchor + 0.1 s.
3. **Sketchy lines:** card outlines and icons use an SVG displacement filter on a `::before` so the text stays crisp. Connectors get their wobble from seeded geometry in `MB.connect`, because a filter's bounding box clips a perfectly straight (0-height) line.
4. **Texture overlays** are frame-owned and sit in the root composition. They need element opacity < 0.6, otherwise HyperFrames' `check` reports all text as occluded. `data-layout-ignore` does not exempt an occluder.
5. **Icon chips:** the icon inliner wraps the icon in a 1em chip, so the agent's sizing and layout are the same for all three icon treatments.
6. **Springy Motion** must not use overshooting eases on wipes, blurs or stroke draw-on, because they overshoot past the end state. The helpers fall back to `power3.out` for those.
7. **Contrast rule vs bundled Palettes:** Sketchbook's mustard `accent3` is 1.8:1 on paper. That is fine as a fill with dark text on it, but it fails "accent vs bg ≥ 3". Whiteboard's `accent3` sits exactly at 3.0. As specified, the rule would block a bundled Preset, so it needs to tell fill use apart from text/line use (or the Palette changes).

## Not tested (deferred by the user)

- Agent reliability for each style: fallback rate, cost and token-lint compliance with real Storyboards.
- Palette/typography swap re-render of agent-written code.
- The always-Canvas camera (Whiteboard) with real Storyboards.

Planned runs (about $12–18 at API prices), all on the CDN Voiceover:
```
node src/pipeline.ts cdn horizontal --preset whiteboard --tag whiteboard
node src/pipeline.ts cdn vertical   --preset sketchbook --tag sketchbook
node src/pipeline.ts cdn horizontal --preset terminal   --tag terminal
# swap test, no agent calls:
node src/pipeline.ts cdn horizontal --preset whiteboard --from whiteboard --palette mint --type fredoka-nunito --tag swap --reuse-storyboard --reuse-code --no-review
```

## Run the look check

```
cd prototypes/voiceover-to-video && npm i
node src/lookcheck.ts && node src/sheet.ts && node src/serve.ts   # http://localhost:4178/lookcheck/
```
