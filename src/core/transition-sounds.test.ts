import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StylePreset, VideoSource } from "../contract";
import storyboard from "./fixtures/storyboard/horizontal.json";
import transcript from "./fixtures/storyboard/transcript.json";
import { BLUEPRINT, connect, RULES } from "./test-support/checker";
import { voiceover } from "./test-support/media";

let workDir = "";
let voice = "";

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "motionbrief-sounds-"));
  voice = await voiceover(workDir, "Voiceover.wav", [{ tone: 45.5 }]);
});

afterAll(() => rm(workDir, { recursive: true, force: true }));

async function core() {
  return connect({ appDataDir: await mkdtemp(join(workDir, "app-data-")) });
}

function source(preset: StylePreset = BLUEPRINT): VideoSource {
  return { storyboard, transcript, rules: RULES, preset, code: {}, voiceover: voice };
}

function withSound(changes: Partial<NonNullable<StylePreset["sound"]>>): StylePreset {
  return { ...BLUEPRINT, sound: { ...BLUEPRINT.sound!, ...changes } };
}

type SoundTag = { src: string; start: number; volume: number };

/** The page's sound effects, in the order the page lists them. */
async function soundEffects(url: string): Promise<{ html: string; sounds: SoundTag[] }> {
  const html = await (await fetch(url)).text();
  const attribute = (tag: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? "";
  const sounds = [...html.matchAll(/<audio [^>]*data-audio-group="sfx"[^>]*>/g)].map(([tag]) => ({
    src: attribute(tag, "src"),
    start: Number(attribute(tag, "data-start")),
    volume: Number(attribute(tag, "data-volume")),
  }));

  return { html, sounds };
}

describe("Transition sounds", () => {
  it("plays the Style Preset's sound on each Transition: a whoosh on push and zoom-through, a soft click on crossfade, none on cut", async () => {
    const preview = await (await core()).preview.open(source());
    const { html, sounds } = await soundEffects(preview.url);

    expect(html).toContain('<hf-audio-group id="sfx"');
    // The fixture: s02 cut, c1 crossfade, camera inside the Canvas, s05 push-left, s06 zoom-through, s07 carry-over, s08 crossfade, s09 cut.
    expect(sounds.map(({ src, start }) => ({ src, start }))).toEqual([
      { src: "assets/sfx/click-soft.opus", start: 10.25 },
      { src: "assets/sfx/whoosh-left.opus", start: 21.45 },
      { src: "assets/sfx/zoom-through.opus", start: 25.85 },
      { src: "assets/sfx/click-soft.opus", start: 36.65 },
    ]);
    expect((await fetch(new URL("assets/sfx/whoosh-left.opus", preview.url))).status).toBe(200);
  });

  it("levels each sound from its measured loudness, offset by the effects level and capped at +12 dB", async () => {
    const client = await core();
    const { sounds: level } = await soundEffects((await client.preview.open(source())).url);
    const { sounds: quieter } = await soundEffects((await client.preview.open(source(withSound({ sfxLevel: -6 })))).url);
    const { sounds: loudest } = await soundEffects((await client.preview.open(source(withSound({ sfxLevel: 12 })))).url);

    quieter.forEach(({ volume }, index) => expect(volume / level[index]!.volume).toBeCloseTo(0.5, 2));
    // 12 dB up is 3.98 times louder, but no sound is ever raised past +12 dB.
    loudest.forEach(({ volume }, index) => expect(volume).toBeCloseTo(Math.min(3.9811, level[index]!.volume * 3.9811), 3));
    expect(Math.max(...loudest.map(({ volume }) => volume))).toBe(3.9811);
  });

  it("plays no sound effects with sound effects off, and none for a Preset without a sound block", async () => {
    const client = await core();
    const silent = { ...BLUEPRINT, sound: undefined };
    const off = await client.preview.open(source(withSound({ sfx: "off" })));
    const none = await client.preview.open(source(silent));

    expect((await soundEffects(off.url)).sounds).toEqual([]);
    expect((await soundEffects(none.url)).sounds).toEqual([]);
    expect(off.timeline.sounds).toEqual([]);
  });

  it("builds another page when only the sound changes", async () => {
    const client = await core();
    const first = await client.preview.open(source());
    const quieter = await client.preview.open(source(withSound({ sfxLevel: -6 })));

    expect(quieter.id).not.toBe(first.id);
  });

  it("lays the sounds out in the timeline, labelled and marked as the Transition rule's", async () => {
    const preview = await (await core()).preview.open(source());

    expect(preview.timeline.sounds).toEqual([
      { start: 10.25, name: "Soft click", source: "transition" },
      { start: 21.45, name: "Whoosh left", source: "transition" },
      { start: 25.85, name: "Zoom through", source: "transition" },
      { start: 36.65, name: "Soft click", source: "transition" },
    ]);
  });
});
