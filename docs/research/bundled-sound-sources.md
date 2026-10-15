# Research: Bundled sound sources

Ticket: [#65](https://github.com/AlsoKnownAs-Ax/MotionBrief/issues/65) · Map: [#64](https://github.com/AlsoKnownAs-Ax/MotionBrief/issues/64) · Checked 2026-10-15

## Answer

- **Bundle SFX from Kenney (CC0).** It is the only sizeable library whose licence lets us redistribute the raw files in an MIT installer with no attribution and no anti-library clause. The UI/click/impact/sci-fi packs cover pops, clicks, UI blips and hits. Quality is clean but reads as "game UI", not cinematic.
- **Kenney has no real whooshes or risers.** Fill that gap with **hand-picked CC0 sounds from Freesound**. Vet each sound one by one, because Freesound licences are set per sound. Or make a handful of whooshes and risers in-house (noise sweeps rendered with the bundled FFmpeg), so we own them outright.
- **No usable bundled music set exists in Kenney or the stock sites.** Kenney "Music Jingles" are 1–5 s game stings, not beds. The one credible CC0 source for beds is **HoliznaCC0** on Free Music Archive (690 tracks, explicitly public domain, lo-fi/chill/ambient). Bundle 3–5 hand-picked tracks and transcode them to Opus. Otherwise ship no music and let users bring their own as Assets.
- **Rejected:** Sonniss GDC bundle, Pixabay, Mixkit. They are free for use in videos, but their licences forbid redistributing the files as files, which is exactly what bundling does.
- **Size:** about 150 short SFX as 48 kHz Opus/OGG is roughly 5–15 MB. 4 music beds of about 3 min at 128 kbps Opus is roughly 12 MB. Either way it is under 30 MB on a 550–650 MB installer.

## Candidates

| Source | License (primary) | Content | Count | Format | Redistribute in installer? | Quality for ByteMonk/Jamie Fenn style |
|---|---|---|---|---|---|---|
| Kenney – Interface Sounds | CC0 ([page](https://kenney.nl/assets/interface-sounds)) | clicks, buttons, UI | 100 | OGG | Yes | Good: crisp, short, consistent |
| Kenney – UI Audio | CC0 ([page](https://kenney.nl/assets/ui-audio)) | clicks, switches | 50 | OGG | Yes | OK (2012, a bit thin) |
| Kenney – Impact Sounds | CC0 ([page](https://kenney.nl/assets/impact-sounds)) | foley impacts | 130 | OGG | Yes | OK for "thud" reveals; foley-ish |
| Kenney – Sci-fi Sounds | CC0 ([page](https://kenney.nl/assets/sci-fi-sounds)) | lasers, engines, tech | 70 | OGG | Yes | Usable for tech-explainer accents |
| Kenney – Digital Audio | CC0 ([page](https://kenney.nl/assets/digital-audio)) | lasers, blips | 60 | OGG | Yes | Retro/game-y; sparing use |
| Kenney – Music Jingles | CC0 ([page](https://kenney.nl/assets/music-jingles)) | short stings | 85 | OGG | Yes | Not beds; maybe intro/outro stings |
| Freesound (CC0-filtered) | Per sound: CC0 / CC-BY / CC-BY-NC ([FAQ](https://freesound.org/help/faq/)) | everything incl. whooshes, risers | huge | WAV/FLAC/etc. | Only CC0 items | Varies; some excellent, so curate by hand |
| HoliznaCC0 (FMA) | Public domain / CC0 ([artist page](https://freemusicarchive.org/music/holiznacc0/)) | lo-fi, chill, ambient, chiptune | 690 tracks | MP3 | Yes | Good enough for an under-voice bed; check each track's licence field on FMA |
| Sonniss #GameAudioGDC | Royalty-free EULA ([license](https://sonniss.com/gdc-bundle-license/)) | pro SFX, tens of GB | — | WAV | **No**: Restriction (c) bans supplying the SFX "as part of a sound effects library, sample pack, asset pack … software development kit" | Excellent, but unusable for bundling. Users can download it themselves and add it as Assets |
| Pixabay sounds/music | Pixabay Content License ([terms](https://pixabay.com/service/terms/)) | SFX + music | large | MP3 | **No**: bans distributing content "on a Standalone basis … as an audio … file" | Good, but licence blocks bundling |
| Mixkit | Mixkit SFX/Music Free License ([license](https://mixkit.co/license/)) | SFX + music | ~mid | WAV/MP3 | **No** (Envato-style licence, use in projects only; the licence text sits in a JS modal, so it was not quoted verbatim) | Good |

Counts and licences for Kenney come from each asset page. The Kenney licence statement ("all game assets … are public domain licensed (CC0) … Attribution is not required") is from [kenney.nl/support](https://kenney.nl/support). The only condition is not to use the Kenney logo.

## Notes

- **Attribution traps avoided:** Kenney, the Freesound CC0 items and HoliznaCC0 all need no credit. Keep a `LICENSES/sounds.md` listing source URLs anyway, for provenance.
- **YouTube Content ID:** CC0 music is sometimes claimed by third parties who re-upload it. HoliznaCC0 tracks are widely used, so there is some claim risk. Bundle few tracks, and record their source URLs so users can dispute a claim.
- **Format:** transcode everything to Opus/OGG at a common loudness, about −16 LUFS for SFX peaks and about −30 LUFS for beds under voice. The bundled FFmpeg can do it at build time.
- **Not verified:** listening tests for each file, and exact unpacked sizes of the Kenney packs (download only). The Mixkit SFX licence was not read verbatim.
