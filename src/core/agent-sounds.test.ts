import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CoreClient, GenerationStatus, IndexedAsset, Project, RevisionStatus, SfxDensity, StoryboardRules, VideoRef } from "../contract";
import type { AgentEvent } from "../modules/connector";
import horizontal from "./fixtures/storyboard/horizontal.json";
import transcript from "./fixtures/storyboard/transcript.json";
import { BLUEPRINT, BROWSER_TIMEOUT_MS, connect as connectChecker, RULES } from "./test-support/checker";
import { connect, follow, generate, newProject, storyboard as stacked, submitsStoryboard } from "./test-support/generation";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "motionbrief-agent-sounds-"));
});

afterAll(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));

/** A sound effect as the Asset index carries it; validation never reads its file. */
function sound(id: string, role?: "impact" | "transition"): IndexedAsset {
  return { id, kind: "sfx", name: id, notes: `Notes on ${id}`, format: "opus", duration: 0.4, loudness: -16, file: `${id}.opus`, ...(role && { role }) };
}

const PUNCH = "bundled:punch";
const BONG = "bundled:bong";
const WHOOSH = "bundled:whoosh-left";
const USER_POP = "c".repeat(64);
const SHOT = "a".repeat(64);
const INDEX: IndexedAsset[] = [
  sound(PUNCH, "impact"),
  sound(BONG, "impact"),
  sound(WHOOSH, "transition"),
  sound(USER_POP),
  { id: SHOT, kind: "image", name: "Shot", notes: "A dashboard", format: "png", width: 16, height: 10, transparent: false, file: "shot.png" },
];

type Placed = { asset: string; at: number };

/** The horizontal fixture with sounds on some Scenes, by Scene id. */
function withSounds(sounds: Record<string, Placed[]>): unknown {
  const storyboard = structuredClone(horizontal) as unknown as { scenes: { id: string; sounds?: Placed[] }[] };
  storyboard.scenes.forEach((scene) => {
    if (sounds[scene.id]) {
      scene.sounds = sounds[scene.id];
    }
  });

  return storyboard;
}

describe("Storyboard validation of the agent's sounds", () => {
  const core = connectChecker();
  const validate = async (storyboard: unknown, sfx: SfxDensity = "lively") => {
    const rules: StoryboardRules = { ...RULES, assets: INDEX, sfx };

    return (await core.storyboard.validate({ storyboard, transcript, rules })).issues.map(({ code, sceneId, field }) => ({ code, sceneId, field }));
  };

  it("accepts sparse impacts on words inside their Scenes", async () => {
    expect(await validate(withSounds({ s05: [{ asset: PUNCH, at: 56 }], s09: [{ asset: BONG, at: 110 }] }), "subtle")).toEqual([]);
  });

  it("takes only agent-placeable sound effects from the index: no unknown ids, Transition sounds, unmarked sounds or images", async () => {
    const storyboard = withSounds({
      s01: [{ asset: "bundled:no-such-sound", at: 3 }],
      s02: [{ asset: WHOOSH, at: 12 }],
      s04: [{ asset: USER_POP, at: 40 }],
      s05: [{ asset: SHOT, at: 56 }],
    });

    expect(await validate(storyboard)).toEqual([
      { code: "SOUND", sceneId: "s01", field: "sounds[0].asset" },
      { code: "SOUND", sceneId: "s02", field: "sounds[0].asset" },
      { code: "SOUND", sceneId: "s04", field: "sounds[0].asset" },
      { code: "SOUND", sceneId: "s05", field: "sounds[0].asset" },
    ]);
  });

  it("places each sound on a word of its own Scene", async () => {
    expect(await validate(withSounds({ s05: [{ asset: PUNCH, at: 70 }] }))).toEqual([{ code: "SOUND", sceneId: "s05", field: "sounds[0].at" }]);
  });

  it("caps sounds per Scene and per stretch of the video by the density, and allows none with sound effects off", async () => {
    const twoInOneScene = withSounds({ s05: [{ asset: PUNCH, at: 54 }, { asset: BONG, at: 60 }] });
    // 45.5 s at about one per 20 s is two sounds.
    const threeInAll = withSounds({ s01: [{ asset: PUNCH, at: 3 }], s05: [{ asset: PUNCH, at: 56 }], s09: [{ asset: BONG, at: 110 }] });

    expect(await validate(twoInOneScene, "lively")).toEqual([]);
    expect(await validate(twoInOneScene, "subtle")).toEqual([{ code: "SOUND", sceneId: "s05", field: "sounds[1]" }]);
    expect(await validate(threeInAll, "lively")).toEqual([]);
    expect(await validate(threeInAll, "subtle")).toEqual([{ code: "SOUND", sceneId: "s09", field: "sounds[0]" }]);
    expect(await validate(withSounds({ s05: [{ asset: PUNCH, at: 56 }] }), "off")).toEqual([{ code: "SOUND", sceneId: "s05", field: "sounds[0]" }]);
  });

  it("leaves the caps to the agent's runs: a saved Storyboard keeps sounds past a lowered density", async () => {
    const saved: StoryboardRules = { ...RULES, assets: INDEX };
    const storyboard = withSounds({ s05: [{ asset: PUNCH, at: 54 }, { asset: BONG, at: 60 }] });

    expect((await core.storyboard.validate({ storyboard, transcript, rules: saved })).issues).toEqual([]);
  });
});

describe("the agent's sounds in the page", () => {
  const core = connectChecker({ appDataDir: join(tmpdir(), "motionbrief-agent-sounds-page") });
  const rules = { ...RULES, assets: INDEX };
  const timelineOf = async (storyboard: unknown, sfx: SfxDensity, words = transcript.words) => {
    const preset = { ...BLUEPRINT, sound: { ...BLUEPRINT.sound!, sfx } };
    const { timeline } = await core.preview.open({ storyboard, transcript: { ...transcript, words }, rules, preset, code: {} });

    return timeline.sounds;
  };

  it("plays each sound on its word, louder than a Transition sound: 6 dB under the Voiceover against 10", async () => {
    const storyboard = withSounds({ s05: [{ asset: PUNCH, at: 56 }] });
    const preview = await core.preview.open({ storyboard, transcript, rules, preset: BLUEPRINT, code: {} });
    const html = await (await fetch(preview.url)).text();
    const volumeOf = (src: string) => Number(new RegExp(`src="${src}"[^>]*data-volume="([^"]+)"`).exec(html)?.[1]);
    const bundled = await core.assets.list({ scope: "bundled" });
    const loudness = (id: string) => {
      const asset = bundled.find((candidate) => candidate.id === id);

      return asset && "loudness" in asset ? asset.loudness : NaN;
    };

    expect(preview.timeline.sounds).toContainEqual({ start: transcript.words[56]!.start, name: "Punch", source: "agent" });
    expect(volumeOf("assets/sfx/punch.opus") / volumeOf("assets/sfx/zoom-through.opus")).toBeCloseTo(10 ** ((4 - loudness(PUNCH) + loudness("bundled:zoom-through")) / 20), 2);
  });

  it("replaces a Transition sound it lands within 0.15 s of, and leaves the others", async () => {
    const storyboard = withSounds({ s04: [{ asset: PUNCH, at: 52 }], s07: [{ asset: BONG, at: 82 }] });
    // s04's last word, 0.05 s before the push into s05 starts.
    const words = transcript.words.map((word, index) => (index === 52 ? { ...word, start: 21.4 } : word));

    expect(await timelineOf(storyboard, "subtle", words)).toEqual([
      { start: 10.25, name: "Soft click", source: "transition" },
      { start: 21.4, name: "Punch", source: "agent" },
      { start: 25.85, name: "Zoom through", source: "transition" },
      { start: transcript.words[82]!.start, name: "Bong", source: "agent" },
      { start: 36.65, name: "Soft click", source: "transition" },
    ]);
  });

  it("drops the sounds past a lowered density in Storyboard order, keeps them all at a higher one, and plays none when off", async () => {
    const storyboard = withSounds({ s01: [{ asset: PUNCH, at: 3 }], s05: [{ asset: PUNCH, at: 54 }, { asset: BONG, at: 60 }], s09: [{ asset: BONG, at: 110 }] });
    const agent = async (sfx: SfxDensity) => (await timelineOf(storyboard, sfx)).filter(({ source }) => source === "agent").map(({ start, name }) => [name, start]);
    const at = (index: number) => transcript.words[index]!.start;

    expect(await agent("lively")).toEqual([["Punch", at(3)], ["Punch", at(54)], ["Bong", at(60)], ["Bong", at(110)]]);
    expect(await agent("subtle")).toEqual([["Punch", at(3)], ["Punch", at(54)]]);
    expect(await timelineOf(storyboard, "off")).toEqual([]);
  });
});


type StackedScene = { id: string; sounds?: Placed[] };

/** The `stacked` Storyboard with sounds on some Scenes, by Scene id. */
function stackedWith(sounds: Record<string, Placed[] | undefined>): { scenes: StackedScene[] } {
  return { ...stacked, scenes: (stacked.scenes as StackedScene[]).map((scene) => ({ ...scene, ...(sounds[scene.id] && { sounds: sounds[scene.id] }) })) };
}

/** A turn in which the Revision agent hands in a patch through its host tool. */
function submitsPatch(scenes: StackedScene[], summary: string): AgentEvent[] {
  return [
    { type: "tool-call", toolUseId: "toolu_patch", name: "mcp__motionbrief__submit_patch", input: { scenes, remove: [], instructions: [], summary } },
    { type: "turn-completed", status: "completed", text: summary },
  ];
}

/** Sends a request and waits for the Revision to end, approving its cost if it asks. */
async function revise(core: CoreClient, video: VideoRef, message: string): Promise<RevisionStatus> {
  const statuses = await follow((signal) => core.video.revision(video, { signal }));
  void statuses.until(({ state }) => state === "approval").then(() => core.video.approveRevision(video));
  await core.video.revise({ ...video, message, scope: [] });
  const ended = await statuses.until(({ state, request }) => ["answered", "done", "failed", "stopped"].includes(state) && request?.message === message);
  statuses.stop();

  return ended;
}

describe("a video with the agent's sounds", () => {
  const generatedWith = stackedWith({ s03: [{ asset: PUNCH, at: 40 }], s05: [{ asset: BONG, at: 65 }] });
  const revised = stackedWith({ s04: [{ asset: PUNCH, at: 55 }], s05: [{ asset: BONG, at: 65 }] });
  const video = (project: Project): VideoRef => ({ projectId: project.id, format: "horizontal" });
  let core: CoreClient;
  let project: Project;
  let replay: Awaited<ReturnType<typeof connect>>["replay"];
  let generated: GenerationStatus;
  let revision: RevisionStatus;
  let silenced: RevisionStatus;
  let words: { start: number }[];
  let sceneCodeByRevision: number;

  beforeAll(async () => {
    const dir = await mkdtemp(join(root, "generation-"));
    const patch = revised.scenes.filter(({ id }) => id === "s03" || id === "s04");
    ({ core, replay } = await connect({
      root: dir,
      script: {
        storyboard: [submitsStoryboard(generatedWith)],
        revision: [submitsPatch(patch, "Moved the punch onto the definition."), [{ type: "turn-completed", status: "completed", text: "Sound effects are off." }]],
      },
    }));
    project = await newProject(core, dir);
    const sceneCode = () => replay.asked.filter(({ options }) => options.label?.startsWith("scene-code ")).length;
    generated = await generate(core, video(project));
    const byGeneration = sceneCode();
    revision = await revise(core, video(project), "Put the punch on the definition instead");
    sceneCodeByRevision = sceneCode() - byGeneration;
    await core.video.changeStyle({ ...video(project), preset: { ...BLUEPRINT, sound: { ...BLUEPRINT.sound!, sfx: "off" } } });
    silenced = await revise(core, video(project), "Add an impact on the last line");
    const transcription = await follow((signal) => core.project.transcription({ projectId: project.id }, { signal }));
    words = (await transcription.until(({ state }) => state === "done")).words;
    transcription.stop();
  }, BROWSER_TIMEOUT_MS * 4);

  afterAll(() => core.project.close({ projectId: project.id }));

  it("gives the Storyboard agent the impacts and stings it may place, and no Transition sounds", () => {
    const system = replay.askedOf("storyboard")[0]?.options.systemPrompt ?? "";

    expect(system).toContain(`${PUNCH} sfx "Punch" (0.43 s):`);
    expect(system).toContain(`${BONG} sfx "Bong" (0.13 s):`);
    expect(system).not.toContain(WHOOSH);
    expect(system).toContain("Sound effects are subtle");
  });

  it("gives Scene agents no sound index", () => {
    const sceneAgents = replay.asked.filter(({ options }) => options.label?.startsWith("scene-code "));

    expect(sceneAgents.length).toBeGreaterThan(0);
    sceneAgents.forEach(({ options, message }) => {
      expect(options.systemPrompt).not.toContain(`${PUNCH} sfx`);
      expect(message).not.toContain(`${PUNCH} sfx`);
    });
  });

  it("plays them on their words, marked as the agent's in the timeline", () => {
    expect(generated.preview?.timeline.sounds.filter(({ source }) => source === "agent")).toEqual([
      { start: words[40]!.start, name: "Punch", source: "agent" },
      { start: words[65]!.start, name: "Bong", source: "agent" },
    ]);
  });

  it("revises them by prompt with the sound index, only re-rendering the Scenes whose sounds changed", () => {
    expect(replay.askedOf("revision")[0]?.options.systemPrompt).toContain(`${PUNCH} sfx "Punch"`);
    expect(revision).toMatchObject({ state: "done", version: 2 });
    expect(revision.units.map(({ id, rebuild }) => [id, rebuild])).toEqual([
      ["s03", "rerender"],
      ["s04", "rerender"],
    ]);
    expect(sceneCodeByRevision).toBe(0);
    expect(revision.preview?.timeline.sounds.filter(({ source }) => source === "agent").map(({ name, start }) => [name, start])).toEqual([
      ["Punch", words[55]!.start],
      ["Bong", words[65]!.start],
    ]);
  });

  it("gives the Revision agent no sound index with sound effects off", () => {
    const system = replay.askedOf("revision")[1]?.options.systemPrompt ?? "";

    expect(silenced.state).toBe("answered");
    expect(system).not.toContain(`${PUNCH} sfx`);
    expect(system).not.toContain("Sound effects are");
  });
});
