# Bundled sounds: provenance

Set version 1. Built by `pnpm assets:bundled` (scripts/assets/bundled-set.ts), transcoded to Opus at 48 kHz.

Every sound is CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/). No attribution is required; it is listed
here so the source of every file is clear.

- Kenney (www.kenney.nl) packs, CC0 per each pack's License.txt and https://kenney.nl/support:
  - Interface Sounds: https://kenney.nl/assets/interface-sounds (download https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip, sha256 `f2193d072726d6758a5f7871b2dcc54dcce0d5c35c6f0a62f92549b327c81232`)
  - Sci-fi Sounds: https://kenney.nl/assets/sci-fi-sounds (download https://kenney.nl/media/pages/assets/sci-fi-sounds/6b296f9ecf-1677589334/kenney_sci-fi-sounds.zip, sha256 `119340f351a5098ad814f78719438c0da355a9ce8a4c8a3af6a8d48aa3d49e04`)
  - Impact Sounds: https://kenney.nl/assets/impact-sounds (download https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip, sha256 `029d734af1582474edf3a694d1b0cebc97c1c152f2f39fa34d4c2bafc5de77f8`)
  - Digital Audio: https://kenney.nl/assets/digital-audio (download https://kenney.nl/media/pages/assets/digital-audio/216eac4753-1677590265/kenney_digital-audio.zip, sha256 `24e6ce28b76a6d8c89cff4d331e0965ff5c3de8a73c612028e9d363cc64e4f06`)
- Sounds made in-house with the bundled FFmpeg from noise and sine generators, dedicated to the public domain under CC0.

| Slug | Source | URL |
| --- | --- | --- |
| `whoosh-left` | Made with the bundled FFmpeg: pink noise in two bands (700 Hz low-pass, 3500 Hz band-pass) swelling over 0.6 s, panned left | scripts/assets/bundled-set.ts |
| `whoosh-right` | Made with the bundled FFmpeg: pink noise in two bands (700 Hz low-pass, 3500 Hz band-pass) swelling over 0.6 s, panned right | scripts/assets/bundled-set.ts |
| `whoosh-up` | Made with the bundled FFmpeg: pink noise in two bands (700 Hz low-pass, 4500 Hz band-pass) swelling over 0.6 s, panned center | scripts/assets/bundled-set.ts |
| `whoosh-down` | Made with the bundled FFmpeg: pink noise in two bands (500 Hz low-pass, 2500 Hz band-pass) swelling over 0.6 s, panned center | scripts/assets/bundled-set.ts |
| `whoosh-soft` | Made with the bundled FFmpeg: pink noise in two bands (500 Hz low-pass, 1800 Hz band-pass) swelling over 0.55 s, panned center | scripts/assets/bundled-set.ts |
| `whoosh-fast` | Made with the bundled FFmpeg: pink noise in two bands (700 Hz low-pass, 3500 Hz band-pass) swelling over 0.35 s, panned center | scripts/assets/bundled-set.ts |
| `whoosh-long` | Made with the bundled FFmpeg: pink noise in two bands (700 Hz low-pass, 3500 Hz band-pass) swelling over 1 s, panned center | scripts/assets/bundled-set.ts |
| `whoosh-airy` | Made with the bundled FFmpeg: white noise in two bands (1200 Hz low-pass, 6000 Hz band-pass) swelling over 0.6 s, panned center | scripts/assets/bundled-set.ts |
| `whoosh-deep` | Made with the bundled FFmpeg: brown noise in two bands (400 Hz low-pass, 1500 Hz band-pass) swelling over 0.75 s, panned center | scripts/assets/bundled-set.ts |
| `swish` | Made with the bundled FFmpeg: pink noise in two bands (700 Hz low-pass, 4000 Hz band-pass) swelling over 0.25 s, panned center | scripts/assets/bundled-set.ts |
| `zoom-in` | Made with the bundled FFmpeg: pink noise in two bands (700 Hz low-pass, 3500 Hz band-pass) swelling over 0.7 s, panned center | scripts/assets/bundled-set.ts |
| `zoom-out` | Made with the bundled FFmpeg: pink noise in two bands (700 Hz low-pass, 3500 Hz band-pass) swelling over 0.7 s, panned center | scripts/assets/bundled-set.ts |
| `zoom-through` | Made with the bundled FFmpeg: pink noise in two bands (600 Hz low-pass, 3000 Hz band-pass) swelling over 0.8 s, panned center | scripts/assets/bundled-set.ts |
| `click-soft` | Made with the bundled FFmpeg: a 1800 Hz sine with a ×0.5 overtone, decaying over 0.12 s | scripts/assets/bundled-set.ts |
| `click-low` | Made with the bundled FFmpeg: a 900 Hz sine with a ×1.5 overtone, decaying over 0.15 s | scripts/assets/bundled-set.ts |
| `tick-soft` | Made with the bundled FFmpeg: a 3200 Hz sine with a ×2 overtone, decaying over 0.06 s | scripts/assets/bundled-set.ts |
| `click-crisp` | Kenney, Interface Sounds: `Audio/click_001.ogg` | https://kenney.nl/assets/interface-sounds |
| `click-plastic` | Kenney, Interface Sounds: `Audio/click_003.ogg` | https://kenney.nl/assets/interface-sounds |
| `tick` | Kenney, Interface Sounds: `Audio/tick_001.ogg` | https://kenney.nl/assets/interface-sounds |
| `select` | Kenney, Interface Sounds: `Audio/select_001.ogg` | https://kenney.nl/assets/interface-sounds |
| `switch` | Kenney, Interface Sounds: `Audio/switch_002.ogg` | https://kenney.nl/assets/interface-sounds |
| `toggle` | Kenney, Interface Sounds: `Audio/toggle_001.ogg` | https://kenney.nl/assets/interface-sounds |
| `pop-open` | Kenney, Interface Sounds: `Audio/maximize_001.ogg` | https://kenney.nl/assets/interface-sounds |
| `pop-close` | Kenney, Interface Sounds: `Audio/minimize_001.ogg` | https://kenney.nl/assets/interface-sounds |
| `slide-open` | Kenney, Sci-fi Sounds: `Audio/doorOpen_000.ogg` | https://kenney.nl/assets/sci-fi-sounds |
| `slide-close` | Kenney, Sci-fi Sounds: `Audio/doorClose_000.ogg` | https://kenney.nl/assets/sci-fi-sounds |
| `punch-heavy` | Kenney, Impact Sounds: `Audio/impactPunch_heavy_000.ogg` | https://kenney.nl/assets/impact-sounds |
| `punch` | Kenney, Impact Sounds: `Audio/impactPunch_medium_000.ogg` | https://kenney.nl/assets/impact-sounds |
| `thud-soft` | Kenney, Impact Sounds: `Audio/impactSoft_heavy_000.ogg` | https://kenney.nl/assets/impact-sounds |
| `thud-light` | Kenney, Impact Sounds: `Audio/impactSoft_medium_000.ogg` | https://kenney.nl/assets/impact-sounds |
| `metal-hit` | Kenney, Impact Sounds: `Audio/impactMetal_heavy_000.ogg` | https://kenney.nl/assets/impact-sounds |
| `plate-hit` | Kenney, Impact Sounds: `Audio/impactPlate_heavy_000.ogg` | https://kenney.nl/assets/impact-sounds |
| `knock` | Kenney, Impact Sounds: `Audio/impactWood_heavy_000.ogg` | https://kenney.nl/assets/impact-sounds |
| `bell-strike` | Kenney, Impact Sounds: `Audio/impactBell_heavy_000.ogg` | https://kenney.nl/assets/impact-sounds |
| `bell-strike-long` | Kenney, Impact Sounds: `Audio/impactBell_heavy_001.ogg` | https://kenney.nl/assets/impact-sounds |
| `glass-tap` | Kenney, Impact Sounds: `Audio/impactGlass_light_000.ogg` | https://kenney.nl/assets/impact-sounds |
| `stone-hit` | Kenney, Impact Sounds: `Audio/impactMining_000.ogg` | https://kenney.nl/assets/impact-sounds |
| `boom-low` | Kenney, Sci-fi Sounds: `Audio/lowFrequency_explosion_000.ogg` | https://kenney.nl/assets/sci-fi-sounds |
| `boom-short` | Kenney, Sci-fi Sounds: `Audio/lowFrequency_explosion_001.ogg` | https://kenney.nl/assets/sci-fi-sounds |
| `tech-hit` | Kenney, Sci-fi Sounds: `Audio/impactMetal_000.ogg` | https://kenney.nl/assets/sci-fi-sounds |
| `force-field` | Kenney, Sci-fi Sounds: `Audio/forceField_000.ogg` | https://kenney.nl/assets/sci-fi-sounds |
| `crunch` | Kenney, Sci-fi Sounds: `Audio/explosionCrunch_000.ogg` | https://kenney.nl/assets/sci-fi-sounds |
| `confirm` | Kenney, Interface Sounds: `Audio/confirmation_001.ogg` | https://kenney.nl/assets/interface-sounds |
| `confirm-bright` | Kenney, Interface Sounds: `Audio/confirmation_002.ogg` | https://kenney.nl/assets/interface-sounds |
| `confirm-short` | Kenney, Interface Sounds: `Audio/confirmation_004.ogg` | https://kenney.nl/assets/interface-sounds |
| `ding` | Kenney, Interface Sounds: `Audio/glass_001.ogg` | https://kenney.nl/assets/interface-sounds |
| `bong` | Kenney, Interface Sounds: `Audio/bong_001.ogg` | https://kenney.nl/assets/interface-sounds |
| `pluck` | Kenney, Interface Sounds: `Audio/pluck_001.ogg` | https://kenney.nl/assets/interface-sounds |
| `drop` | Kenney, Interface Sounds: `Audio/drop_001.ogg` | https://kenney.nl/assets/interface-sounds |
| `question` | Kenney, Interface Sounds: `Audio/question_001.ogg` | https://kenney.nl/assets/interface-sounds |
| `error` | Kenney, Interface Sounds: `Audio/error_004.ogg` | https://kenney.nl/assets/interface-sounds |
| `glitch` | Kenney, Interface Sounds: `Audio/glitch_001.ogg` | https://kenney.nl/assets/interface-sounds |
| `power-up` | Kenney, Digital Audio: `Audio/powerUp1.ogg` | https://kenney.nl/assets/digital-audio |
| `phaser-up` | Kenney, Digital Audio: `Audio/phaserUp1.ogg` | https://kenney.nl/assets/digital-audio |
| `three-tone` | Kenney, Digital Audio: `Audio/threeTone1.ogg` | https://kenney.nl/assets/digital-audio |
| `two-tone` | Kenney, Digital Audio: `Audio/twoTone1.ogg` | https://kenney.nl/assets/digital-audio |
| `zap-up` | Kenney, Digital Audio: `Audio/zapThreeToneUp.ogg` | https://kenney.nl/assets/digital-audio |
| `blip-up` | Kenney, Digital Audio: `Audio/highUp.ogg` | https://kenney.nl/assets/digital-audio |
| `blip-down` | Kenney, Digital Audio: `Audio/lowDown.ogg` | https://kenney.nl/assets/digital-audio |
| `sub-drop` | Made with the bundled FFmpeg: a 120→40 Hz sine falling and decaying over 0.9 s | scripts/assets/bundled-set.ts |
| `riser` | Made with the bundled FFmpeg: pink noise and a 200→900 Hz sine growing over 1.5 s | scripts/assets/bundled-set.ts |
| `riser-short` | Made with the bundled FFmpeg: pink noise and a 300→1200 Hz sine growing over 0.8 s | scripts/assets/bundled-set.ts |
| `ding-soft` | Made with the bundled FFmpeg: a 1320 Hz sine with a ×2.76 overtone, decaying over 1.2 s | scripts/assets/bundled-set.ts |
