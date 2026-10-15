# Research: Audio in HyperFrames

Ticket: [#66](https://github.com/AlsoKnownAs-Ax/MotionBrief/issues/66) · Map: [#64](https://github.com/AlsoKnownAs-Ax/MotionBrief/issues/64) · Date: 2026-10-15

## Answer

**Yes, mostly, on the version we already pin (0.8.113).** Multiple audio tracks, per-track volume, volume automation, mixer buses (`<hf-audio-group>`), FX chains and the Voiceover carve (spectral dip + level duck of a bed under a voice) all exist in 0.8.113, and the export path renders the same attributes the preview plays. **Loudness normalization to a LUFS target is not a HyperFrames feature**: we would measure with our own FFmpeg (`ebur128`) and write a static `data-volume`, which keeps parity because it is just a gain. No upgrade and no FFmpeg-side mixing is needed.

## Pinned version

`package.json`: `hyperframes`, `@hyperframes/producer`, `@hyperframes/player` all `0.8.113` (installed: `@hyperframes/core`, `engine`, `lint`, `parsers`, `studio-server` at 0.8.113). Latest on npm today: `0.8.161` (`npm view hyperframes version`).

## Capabilities in 0.8.113 (from installed sources)

| Need | Authoring | Preview | Export | Source |
|---|---|---|---|---|
| Several tracks | several `<audio>` clips with `data-start`/`data-duration`/`data-track-index` | runtime plays each | `engine/dist/services/audioMixer.js` `mixAudioTracks` → FFmpeg `amix` (master compensates amix's 1/N) | audioMixer.js:660-690 |
| Per-track volume | `data-volume` (clamped, up to +12 dB via `@hyperframes/core/audio-gain`) | `runtime/media.js` | `clampAudioGain` per input | audioMixer.js imports; core `audioGain.js` |
| Fades | fade attrs (`@hyperframes/core/audio-fade`) | runtime | `readElementFades` | audioMixer.js |
| Volume automation | `HF_AUDIO_AUTOMATION_ATTR` lane (`@hyperframes/core/audio-automation`) or GSAP tween of volume | `runtime/mediaVolumeEnvelope.js`, `audioAutomationVolume.js` | `sampleAutomationLane` → `applyVolumeEnvelopeToWav` per sample before `amix` | `engine/dist/services/audioVolumeEnvelope.js` |
| Buses | `<hf-audio-group id>` + `data-audio-group` on members, group `data-volume`/FX | `core/dist/audioGroups.js` | nested `amix` per group (audioMixer.js:800-850, 1206) | |
| FX (EQ, compressor, gain, …) | `data-fx-chain` | Web Audio `AudioContext` (`runtime/webAudioRoute.js`, `audio-fx-runtime`) | same DSP in an `OfflineAudioContext` in the headless browser (`engine/dist/services/audioFxRender.js`) | core `audioFx.js:6` |
| Ducking under Voiceover | `@hyperframes/core/audio-carve`: `analyseCarveBands`, `analyseCarveDuck`, `carveBandsToChain` produce an ordinary FX chain (+ duck lane) on the bed | as FX/automation | as FX/automation | core `audioCarve.js` header: "a carve is just a chain the studio generated rather than a separate rendering path" |
| Loudness normalization | **none.** `audio-leveller` is RMS "evening out", explicitly "NOT loudness normalisation"; studio-server has LUFS *matching* of one track to another via FFmpeg `ebur128`, writing `data-volume` | — | no master `loudnorm` | core `audioLeveller.js:9`; studio-server `chunk-DSVQ2U7J.js:229-267` |

Consequences for us:

- The carve analysis is a library call, not a render feature: the engine never reads `data-fx-carve`. The Assembler would decode the Voiceover and bed to PCM (our FFmpeg), call `analyseCarveBands`/`analyseCarveDuck`, and write the resulting `data-fx-chain`/automation on the bed. Deterministic, offline, no studio needed.
- Loudness: measure each Asset (and the Voiceover) once with `ffmpeg -af ebur128` (cacheable by sha256, like resampled audio in `src/modules/cache`), set `data-volume` to hit a target. Gain is capped at +12 dB; quieter sources need a Checker rule or pre-processing. True-peak/limiting of the final mix is not covered; a limiter in the bus FX chain is the in-HyperFrames option.

## Preview/export parity

Same attributes drive both paths; FX run the same DSP code (AudioContext vs OfflineAudioContext), automation is sampled from the same lane parser. Known gaps: `amix` + AAC encode vs browser mixing (no limiter → clipping can differ; the mixer has a degradation report on success, audioMixer.js:1308), and FFmpeg-version quirks the mixer already works around (audioMixer.js:801). **Not verified end to end** here: no render or A/B listening test was run (no paid or long runs).

### If we mixed in FFmpeg at export instead

Preview would play a different graph than export (browser volume vs FFmpeg filters): every duck/automation would need two implementations kept in sync, and the user would hear in preview something other than the file. Only worth it for a master `loudnorm` pass, and that one is one-way (it changes what preview played); prefer static per-track gain.

## Current Assembler

`src/modules/assembler/assemble.ts:77-82` writes one root clip: `<audio id="el-voiceover" src=… data-start="0" data-duration=<video> data-track-index="10" data-volume="1">`, absent when there is no Voiceover. Adding music/SFX = more `<audio>` clips on other track indices (optionally grouped in `<hf-audio-group>`), plus the carve chain on the music bed. The file name/id `el-voiceover` already classifies as voice for `classifyAudioName`.

## Newer versions (0.8.114 → 0.8.161)

Not needed for this map. The audio features above are already in 0.8.113; source comments mention a dB fader for the volume lane landing "in stages" (`audioLeveller.js`), which later versions may complete. Changelog for the 48 newer releases was not reviewed in detail. Upgrade cost is the usual: bump the three pins together, rerun the eval/render checks, no Electron or native-deps change since HyperFrames ships as npm packages.
