import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CoreClient, StylePreset, VideoSource } from "../contract";
import storyboard from "./fixtures/storyboard/horizontal.json";
import transcript from "./fixtures/storyboard/transcript.json";
import { BLUEPRINT, connect, RULES } from "./test-support/checker";
import { voiceover } from "./test-support/media";

let workDir = "";
let voice = "";

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "motionbrief-music-"));
  voice = await voiceover(workDir, "Voiceover.wav", [{ tone: 45.5 }]);
});

afterAll(() => rm(workDir, { recursive: true, force: true }));

/** A core whose Library holds a music bed `seconds` long, as loud as the Voiceover. */
async function withBed(seconds: number): Promise<{ client: CoreClient; bed: string }> {
  const client = await connect({ appDataDir: await mkdtemp(join(workDir, "app-data-")) });
  const path = await voiceover(workDir, `Bed-${seconds}.wav`, [{ tone: seconds }]);
  const { id } = await client.assets.import({ scope: "library", path, name: "Calm bed", kind: "music", notes: "" });

  return { client, bed: id };
}

function source(sound: Partial<NonNullable<StylePreset["sound"]>>): VideoSource {
  return { storyboard, transcript, rules: RULES, preset: { ...BLUEPRINT, sound: { ...BLUEPRINT.sound!, ...sound } }, code: {}, voiceover: voice };
}

type BedTag = { id: string; src: string; start: number; duration: number; volume: number; track: string; fadeIn: number; fadeOut: number; chain: string; automation: string };

/** The page's music bed: one `<audio>` per pass through the bed file. */
async function bedOf(url: string): Promise<BedTag[]> {
  const html = await (await fetch(url)).text();
  const attribute = (tag: string, name: string) => new RegExp(`${name}='([^']*)'|${name}="([^"]*)"`).exec(tag)?.slice(1).find((value) => value !== undefined) ?? "";

  return [...html.matchAll(/<audio id="music-bed[^>]*>/g)].map(([tag]) => ({
    id: attribute(tag, "id"),
    src: attribute(tag, "src"),
    start: Number(attribute(tag, "data-start")),
    duration: Number(attribute(tag, "data-duration")),
    volume: Number(attribute(tag, "data-volume")),
    track: attribute(tag, "data-track-index"),
    fadeIn: Number(attribute(tag, "data-fade-in")),
    fadeOut: Number(attribute(tag, "data-fade-out")),
    chain: attribute(tag, "data-fx-chain"),
    automation: attribute(tag, "data-automation"),
  }));
}

describe("the music bed", () => {
  it("plays under the whole video, fading in over a second and out over the last Scene, carved and ducked under the Voiceover", async () => {
    const { client, bed } = await withBed(60);
    const preview = await client.preview.open(source({ music: bed }));
    const [tag, ...more] = await bedOf(preview.url);
    // The fixture's last Scene, s09, starts 0.25 s before its first word at 41.7 s, so 4.05 s before the end at 45.5.
    const lastScene = 4.05;

    expect(more).toEqual([]);
    expect(tag).toMatchObject({ start: 0, duration: 45.5, track: "11", fadeIn: 1, fadeOut: lastScene });
    expect(tag!.src).toMatch(/^assets\/music\//);
    expect((await fetch(new URL(tag!.src, preview.url))).status).toBe(200);
    expect(JSON.parse(tag!.chain)).toMatchObject({ nodes: expect.arrayContaining([expect.objectContaining({ type: "peaking" })]) });
    expect(JSON.parse(tag!.automation)).toMatchObject({ version: 1, lanes: [{ target: "volume" }] });
    expect(preview.timeline.music).toEqual({ name: "Calm bed", fadeIn: 1, fadeOut: lastScene });
  });

  it("sits 18 dB under the Voiceover's loudness by default, moved by the music level", async () => {
    const { client, bed } = await withBed(60);
    const [standard] = await bedOf((await client.preview.open(source({ music: bed }))).url);
    const [quieter] = await bedOf((await client.preview.open(source({ music: bed, musicLevel: -24 }))).url);

    // Bed and Voiceover are the same tone, so the gain is the level itself: -18 dB, then -24 dB.
    expect(standard!.volume).toBeCloseTo(0.1259, 2);
    expect(quieter!.volume).toBeCloseTo(0.0631, 2);
  });

  it("loops a bed shorter than the video, crossfading each pass into the next", async () => {
    const { client, bed } = await withBed(20);
    const passes = await bedOf((await client.preview.open(source({ music: bed }))).url);

    // 20 s passes overlapping by a 2 s crossfade cover the 45.5 s video in three.
    expect(passes.map(({ start, duration, fadeIn, fadeOut }) => ({ start, duration, fadeIn, fadeOut }))).toEqual([
      { start: 0, duration: 20, fadeIn: 1, fadeOut: 2 },
      { start: 18, duration: 20, fadeIn: 2, fadeOut: 2 },
      { start: 36, duration: 9.5, fadeIn: 2, fadeOut: 4.05 },
    ]);
    expect(new Set(passes.map(({ src }) => src)).size).toBe(1);
    passes.forEach(({ automation }) => expect(JSON.parse(automation)).toMatchObject({ lanes: [{ target: "volume" }] }));
  });

  it("plays no bed with music none, or one that isn't an Asset", async () => {
    const { client } = await withBed(60);
    const none = await client.preview.open(source({ music: "none" }));
    const missing = await client.preview.open(source({ music: "f".repeat(64) }));

    expect(await bedOf(none.url)).toEqual([]);
    expect(await bedOf(missing.url)).toEqual([]);
    expect(none.timeline.music).toBeNull();
  });
});
