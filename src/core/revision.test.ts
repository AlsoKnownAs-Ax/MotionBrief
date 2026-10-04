import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CoreClient, Project, RevisionStatus, UnitCode, VideoRef } from "../contract";
import type { AgentEvent } from "../modules/connector";
import { bundledPreset } from "../modules/style";
import { createCore } from "./composition-root";
import { createReplayConnector, type ReplayScript } from "./fixtures/replay-connector";
import { voiceover } from "./test-support/media";
import { fakeWhisper, whisperFixture } from "./test-support/whisper";

const FIXTURES = join(import.meta.dirname, "fixtures");

type Scene = { id: string; from: number; to: number; canvas?: string; transition?: { type: string }; content: Record<string, unknown> };
type Storyboard = { format: "horizontal"; scenes: Scene[] };

/** The Storyboard of the `stacked` Transcript's first generation: five lone Scenes. */
const storyboard = JSON.parse(await readFile(join(FIXTURES, "generation", "storyboard.json"), "utf8")) as Storyboard;

/** Where each variant of Scene code is committed: the first generation's, or the Revision tests' own. */
const VARIANT_FOLDERS: Record<string, string> = { good: "generation" };

/** Committed Scene code: the first generation's, of which `good` passes every check, or a variant of it for Revisions. */
async function unitCode(variant: string, unit: string): Promise<UnitCode> {
  const dir = join(FIXTURES, VARIANT_FOLDERS[variant] ?? "revision", variant);
  const [css, html, js] = await Promise.all(["css", "html", "js"].map((part) => readFile(join(dir, `${unit}.${part}`), "utf8")));

  return { css: css ?? "", html: html ?? "", js: js ?? "" };
}

/** `good` s04, except that its definition is revealed by 1.5 s at the latest, wherever it is anchored. */
const earlyDefinition = await unitCode("early-definition", "s04");


function scene(storyboard: Storyboard, id: string): Scene {
  return structuredClone(storyboard.scenes.find((candidate) => candidate.id === id)!);
}

type Patch = { scenes: Scene[]; remove?: string[]; captions?: boolean; instructions?: { scene: string; text: string }[]; summary: string };

/** A turn in which the Revision agent hands in a patch through its host tool. */
function submitsPatch({ scenes, remove = [], captions, instructions = [], summary }: Patch): AgentEvent[] {
  return [
    { type: "tool-call", toolUseId: "toolu_patch", name: "mcp__motionbrief__submit_patch", input: { scenes, remove, captions, instructions, summary } },
    { type: "turn-completed", status: "completed", text: summary },
  ];
}

/** A turn in which the Revision agent only replies. */
function replies(text: string): AgentEvent[] {
  return [{ type: "turn-completed", status: "completed", text }];
}

function submitsCode(code: UnitCode): AgentEvent[] {
  return [
    { type: "tool-call", toolUseId: "toolu_code", name: "mcp__motionbrief__submit_scene_code", input: code },
    { type: "turn-completed", status: "completed", text: "Submitted the Scene code." },
  ];
}

const MODEL = randomBytes(1024);

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "motionbrief-revision-"));
});

afterAll(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));

/**
 * A core replaying `script`, with an open, transcribed Project of the `stacked` Voiceover in Blueprint and 16:9. The
 * replay connector is an API key; "Approve cost before running" is off unless `approveCost`.
 */
async function connect(script: ReplayScript, { approveCost = false } = {}) {
  const dir = await mkdtemp(join(root, "core-"));
  const replay = createReplayConnector(script);
  const modelPin = { version: "test", url: "http://127.0.0.1:9/model.bin", sha256: createHash("sha256").update(MODEL).digest("hex"), size: MODEL.length };
  const { router } = createCore({
    appVersion: "1.2.3",
    appDataDir: join(dir, "app-data"),
    projectsDir: join(dir, "Projects"),
    cacheDir: join(dir, "cache"),
    modelPin,
    adapters: { connector: replay.connector, whisper: fakeWhisper(await whisperFixture("stacked", 1)) },
  });
  const core = createRouterClient(router);
  await core.settings.update({ approveCost });
  await writeFile(join(dir, "model.bin"), MODEL);
  await core.transcriptionModel.import({ path: join(dir, "model.bin") });

  for await (const { state } of await core.transcriptionModel.watch()) {
    if (state === "ready") {
      break;
    }
  }

  await mkdir(join(dir, "user"), { recursive: true });
  const project = await core.project.create({ voiceoverPath: await voiceover(join(dir, "user"), "Caching.wav", [{ tone: 33.6 }]) });

  for await (const { state } of await core.project.transcription({ projectId: project.id })) {
    if (state === "done") {
      break;
    }
  }

  return { core, replay, project, video: { projectId: project.id, format: "horizontal" } satisfies VideoRef };
}

/** A unit's file in the video's content-addressed store, as the Project store writes it. */
function unitFile(code: UnitCode) {
  const text = `${JSON.stringify(code, null, 2)}\n`;

  return { text, hash: createHash("sha256").update(text).digest("hex") };
}

/** Saves Version 1 of the Project's 16:9 video, as a first generation leaves it. */
async function generated(project: Project, generatedStoryboard: Storyboard, code: Record<string, UnitCode>, flagged: string[] = []) {
  const video = join(project.path, "horizontal");
  await mkdir(join(video, "units"), { recursive: true });
  await mkdir(join(video, "versions"), { recursive: true });
  const units: Record<string, string> = {};

  for (const [unit, unitCodeOf] of Object.entries(code)) {
    const { text, hash } = unitFile(unitCodeOf);
    await writeFile(join(video, "units", `${hash}.json`), text);
    units[unit] = hash;
  }

  const version = {
    storyboard: generatedStoryboard,
    preset: bundledPreset("blueprint"),
    captions: false,
    units,
    flags: flagged.map((unit) => ({ unit, kind: "fallback", reason: "[contract MISSING_ELEMENT] It never appears." })),
    models: { storyboard: "claude-opus-5-5", sceneCode: "claude-opus-5-5" },
    frameContractVersion: "1.0.0",
    version: 1,
    createdAt: "2026-10-04T12:00:00.000Z",
    origin: "generation",
  };
  await writeFile(join(video, "versions", "1.json"), `${JSON.stringify(version, null, 2)}\n`);

  return units;
}

/** Version 1 as the first generation test leaves it: four units of `good` code, and s05 a flagged fallback. */
async function generatedGood(project: Project, code: Partial<Record<string, UnitCode>> = {}) {
  const good = Object.fromEntries(await Promise.all(["s01", "s02", "s03", "s04"].map(async (unit) => [unit, code[unit] ?? (await unitCode("good", unit))] as const)));

  return generated(project, storyboard, good, ["s05"]);
}

async function readVersion(project: Project, number: number) {
  return JSON.parse(await readFile(join(project.path, "horizontal", "versions", `${number}.json`), "utf8")) as {
    storyboard: Storyboard;
    units: Record<string, string>;
    flags: { unit: string; kind: string; reason: string }[];
    origin: string;
    revision?: { request: string; scope: string[]; summary: string; notApplied: string[] };
  };
}

async function versions(project: Project) {
  return (await readdir(join(project.path, "horizontal", "versions"))).sort();
}

/** Every status a video's Revision streams, and a way to wait for one. */
async function watch(core: CoreClient, video: VideoRef) {
  const statuses: RevisionStatus[] = [];
  const waiters: { matches: (status: RevisionStatus) => boolean; resolve: (status: RevisionStatus) => void }[] = [];
  const stop = new AbortController();

  void (async () => {
    for await (const status of await core.video.revision(video, { signal: stop.signal })) {
      statuses.push(status);
      waiters.filter(({ matches }) => matches(status)).forEach(({ resolve }) => resolve(status));
    }
  })().catch(() => undefined);

  const until = (matches: (status: RevisionStatus) => boolean) =>
    new Promise<RevisionStatus>((resolve) => {
      const seen = statuses.find(matches);

      if (seen) {
        resolve(seen);
        return;
      }

      waiters.push({ matches, resolve });
    });
  await until(() => true);

  return { statuses, until, stop: () => stop.abort() };
}

const ENDED = new Set(["answered", "done", "failed", "stopped"]);

/** Sends a request and waits for the Revision to end, approving its cost if it asks. */
async function revise(core: CoreClient, video: VideoRef, message: string, scope: string[] = []) {
  const revision = await watch(core, video);
  void revision.until(({ state }) => state === "approval").then(() => core.video.approveRevision(video));
  await core.video.revise({ ...video, message, scope });
  const ended = await revision.until(({ state, request }) => ENDED.has(state) && request?.message === message);
  revision.stop();

  return { ended, statuses: revision.statuses };
}


/** The units Scene-code subagents were asked to write, whatever order they ran in. */
function regenerated(replay: ReturnType<typeof createReplayConnector>) {
  const labels = replay.asked.map(({ options }) => options.label ?? "").filter((label) => label.startsWith("scene-code "));

  return [...new Set(labels.map((label) => label.slice("scene-code ".length)))].sort();
}

function unitStatus(status: RevisionStatus, id: string) {
  return status.units.find((unit) => unit.id === id);
}

// Each Revision checks units in the pinned chrome-headless-shell, each check taking seconds.
const RUN_TIMEOUT_MS = 300_000;

describe("a Revision that moves things in time", () => {
  let connected: Awaited<ReturnType<typeof connect>>;
  let v1Units: Record<string, string>;
  let done: RevisionStatus;
  let statuses: RevisionStatus[];

  beforeAll(async () => {
    const next = { s01: scene(storyboard, "s01"), s02: scene(storyboard, "s02"), s04: scene(storyboard, "s04") };
    next.s01.transition = { type: "cut" };
    (next.s02.content.items as { id: string; at: number }[])[1]!.at = 21;
    (next.s04.content.definition as { at: number }).at = 58;
    connected = await connect({
      revision: [submitsPatch({ scenes: Object.values(next), summary: "Cut into the list, and showed the cache and the definition a beat later." })],
      "scene-code s04": [submitsCode(await unitCode("good", "s04"))],
    });
    v1Units = await generatedGood(connected.project, { s04: earlyDefinition });
    ({ ended: done, statuses } = await revise(connected.core, connected.video, "Hold the cache and the definition a beat longer"));
  }, RUN_TIMEOUT_MS);

  afterAll(() => connected?.core.project.close({ projectId: connected.project.id }));

  it("runs one fresh session of the Revision agent, closed once it is done", () => {
    expect(connected.replay.askedOf("revision").map(({ options }) => options.model)).toEqual(["claude-opus-5-5"]);
    expect(connected.replay.sessions().open).toBe(0);
  });

  it("only re-renders units whose Transitions and anchor words changed, with no agent writing their code", () => {
    expect(done.units.filter(({ rebuild }) => rebuild === "rerender").map(({ id }) => id)).toEqual(["s01", "s02"]);
    expect(regenerated(connected.replay)).toEqual(["s04"]);
  });

  it("regenerates a re-rendered unit that then fails the contract", () => {
    expect(unitStatus(done, "s04")).toMatchObject({ rebuild: "regenerate", status: "ready", attempts: 1 });
  });

  it("marks the Scenes it works on as revising while the current Version plays on", () => {
    const rebuilding = statuses.find(({ state }) => state === "rebuilding");

    expect(rebuilding?.affected).toEqual(["s01", "s02", "s04"]);
    expect(rebuilding?.preview).toBeUndefined();
  });

  it("saves a new Version that shares every unit it didn't regenerate, with the summary", async () => {
    const saved = await readVersion(connected.project, 2);

    expect(done).toMatchObject({ state: "done", version: 2, summary: "Cut into the list, and showed the cache and the definition a beat later.", notApplied: [] });
    expect(saved.origin).toBe("revision");
    expect(saved.revision).toEqual({
      request: "Hold the cache and the definition a beat longer",
      scope: [],
      summary: "Cut into the list, and showed the cache and the definition a beat later.",
      notApplied: [],
    });
    expect(saved.units).toEqual({ ...v1Units, s04: unitFile(await unitCode("good", "s04")).hash });
    expect(saved.flags.map(({ unit }) => unit)).toEqual(["s05"]);
    expect(saved.storyboard.scenes[0]?.transition).toEqual({ type: "cut" });
    expect(done.preview?.timeline.scenes.map(({ id, status }) => [id, status])).toEqual([
      ["s01", "ready"],
      ["s02", "ready"],
      ["s03", "ready"],
      ["s04", "ready"],
      ["s05", "fallback"],
    ]);
  });
});

describe("a Revision that changes content", () => {
  let connected: Awaited<ReturnType<typeof connect>>;
  let v1Units: Record<string, string>;
  let done: RevisionStatus;
  let statuses: RevisionStatus[];

  beforeAll(async () => {
    const s03 = scene(storyboard, "s03");
    (s03.content.caption as { text: string }).text = "Instant";
    // Neither subagent has a recorded turn, so both stop before handing in code: s01's instruction can't be applied,
    // and s03's new content ends as a fallback.
    connected = await connect(
      {
        revision: [
          submitsPatch({
            scenes: [s03],
            instructions: [{ scene: "s01", text: "Make the headline twice as big" }],
            summary: "Shortened the stat's caption and made the hook's headline bigger.",
          }),
        ],
      },
      { approveCost: true },
    );
    v1Units = await generatedGood(connected.project);
    ({ ended: done, statuses } = await revise(connected.core, connected.video, "Shorter caption on the stat, bigger hook headline", ["s01", "s03"]));
  }, RUN_TIMEOUT_MS);

  afterAll(() => connected?.core.project.close({ projectId: connected.project.id }));

  it("regenerates the units whose content changed or that have an instruction, and nothing else", () => {
    expect(regenerated(connected.replay)).toEqual(["s01", "s03"]);
    expect(done.units.map(({ id, rebuild }) => [id, rebuild]).sort()).toEqual([
      ["s01", "regenerate"],
      ["s03", "regenerate"],
    ]);
  });

  it("waits for approval of the regenerated Scenes' cost after planning, on an API key with approval on", () => {
    const approval = statuses.find(({ state }) => state === "approval");
    const asked = statuses.indexOf(approval!);

    expect(approval?.costUsd?.high).toBeGreaterThan(0);
    expect(statuses.slice(0, asked).some(({ state }) => state === "rebuilding")).toBe(true);
    // Nothing was regenerated before the approval.
    expect(statuses.slice(0, asked + 1).flatMap(({ units }) => units).every(({ status }) => status === "queued" || status === "ready")).toBe(true);
  });

  it("keeps the previous code of a unit whose instruction couldn't be applied, and says so", async () => {
    const saved = await readVersion(connected.project, 2);

    expect(done).toMatchObject({ state: "done", version: 2, notApplied: ["s01"] });
    expect(saved.units.s01).toBe(v1Units.s01);
    expect(saved.revision?.notApplied).toEqual(["s01"]);
  });

  it("flags a changed Scene that ends as a fallback in the new Version", async () => {
    const saved = await readVersion(connected.project, 2);

    expect(saved.units.s03).toBeUndefined();
    expect(saved.flags.map(({ unit, kind }) => [unit, kind])).toEqual([
      ["s03", "fallback"],
      ["s05", "fallback"],
    ]);
    expect(done.preview?.timeline.scenes.find(({ id }) => id === "s03")?.status).toBe("fallback");
  });
});

describe("a Revision", () => {
  it("answers a question, or asks one, without making a Version", async () => {
    const { core, project, video } = await connect({ revision: [replies("The cache Scene is the fourth one.")] });
    await generatedGood(project);

    const { ended } = await revise(core, video, "Which Scene explains the cache?");

    expect(ended).toMatchObject({ state: "answered", reply: "The cache Scene is the fourth one." });
    expect(await versions(project)).toEqual(["1.json"]);
    await core.project.close({ projectId: project.id });
  }, 60_000);

  it(
    "regenerates the whole Canvas when anything inside it changes",
    async () => {
      const onCanvas: Storyboard = structuredClone(storyboard);
      onCanvas.scenes[2]!.canvas = "c1";
      onCanvas.scenes[2]!.transition = { type: "camera" };
      onCanvas.scenes[3]!.canvas = "c1";
      const s04 = scene(onCanvas, "s04");
      (s04.content.definition as { at: number }).at = 58;
      const { core, replay, project, video } = await connect({ revision: [submitsPatch({ scenes: [s04], summary: "Showed the definition later." })] });
      const code = Object.fromEntries(await Promise.all(["s01", "s02"].map(async (unit) => [unit, await unitCode("good", unit)] as const)));
      await generated(project, onCanvas, code, ["c1", "s05"]);

      const { ended } = await revise(core, video, "Show the definition later", ["s04"]);

      expect(regenerated(replay)).toEqual(["c1"]);
      expect(ended).toMatchObject({ state: "done", units: [{ id: "c1", rebuild: "regenerate", status: "fallback" }], affected: [] });
      expect((await readVersion(project, 2)).flags.map(({ unit }) => unit)).toEqual(["c1", "s05"]);
      await core.project.close({ projectId: project.id });
    },
    RUN_TIMEOUT_MS,
  );

  it("re-renders both sides of a carry-over that now morphs another element", async () => {
    // s04 carries its "headline" into the outro's headline; the patch carries its "cta" instead.
    const carrying: Storyboard = structuredClone(storyboard);
    const s04 = carrying.scenes[3]!;
    s04.content.related = [
      { id: "headline", text: "Fast answers", at: 57 },
      { id: "cta", text: "Never stale", at: 58 },
    ];
    s04.transition = { type: "carry-over", element: "headline" } as Scene["transition"];
    const revised = structuredClone(s04);
    revised.transition = { type: "carry-over", element: "cta" } as Scene["transition"];
    const { core, replay, project, video } = await connect({ revision: [submitsPatch({ scenes: [revised], summary: "Carried the call to action instead." })] }, { approveCost: true });
    const code = Object.fromEntries(await Promise.all(["s01", "s02", "s03"].map(async (unit) => [unit, await unitCode("good", unit)] as const)));
    await generated(project, carrying, code, ["s04", "s05"]);

    const { ended, statuses } = await revise(core, video, "Carry the call to action into the outro", ["s04"]);

    expect(ended).toMatchObject({ state: "done", version: 2 });
    // Re-rendering costs nothing, so it never asks for approval.
    expect(statuses.some(({ state }) => state === "approval")).toBe(false);
    expect(ended.units.map(({ id, rebuild }) => [id, rebuild])).toEqual([
      ["s04", "rerender"],
      ["s05", "rerender"],
    ]);
    expect(regenerated(replay)).toEqual([]);
    expect((await readVersion(project, 2)).storyboard.scenes[3]?.transition).toEqual({ type: "carry-over", element: "cta" });
    await core.project.close({ projectId: project.id });
  }, 60_000);

  it("sends a patch that changes Scenes outside the selection back to the agent", async () => {
    const outside = scene(storyboard, "s02");
    (outside.content.title as { text: string }).text = "Cache wins";
    const inside = scene(storyboard, "s04");
    (inside.content.definition as { at: number }).at = 57;
    const { core, replay, project, video } = await connect({
      revision: [
        submitsPatch({ scenes: [inside, outside], summary: "Showed the definition later and renamed the list." }),
        submitsPatch({ scenes: [inside], summary: "Showed the definition later." }),
      ],
    });
    const v1Units = await generatedGood(project);

    const { ended } = await revise(core, video, "Show the definition a little later", ["s04"]);
    const saved = await readVersion(project, 2);

    expect(replay.askedOf("revision")).toHaveLength(2);
    expect(ended).toMatchObject({ state: "done", summary: "Showed the definition later." });
    expect(saved.storyboard.scenes[1]).toEqual(storyboard.scenes[1]);
    expect(saved.units).toEqual(v1Units);
  }, RUN_TIMEOUT_MS);

  it(
    "fails with the issues of a patch that is still invalid after 2 retries, leaving no Version",
    async () => {
      const tooLong = scene(storyboard, "s04");
      tooLong.to = 71;
      const invalid = submitsPatch({ scenes: [tooLong], remove: ["s05"], summary: "Merged the last two Scenes." });
      const { core, replay, project, video } = await connect({ revision: [invalid, invalid, invalid] });
      await generatedGood(project);

      const { ended } = await revise(core, video, "Merge the last two Scenes");

      expect(ended).toMatchObject({ state: "failed", error: { code: "PATCH_INVALID", issues: expect.arrayContaining([expect.objectContaining({ code: "PACING", sceneId: "s04" })]) } });
      expect(replay.askedOf("revision")).toHaveLength(3);
      expect(regenerated(replay)).toEqual([]);
      expect(await versions(project)).toEqual(["1.json"]);
      await core.project.close({ projectId: project.id });
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "follows the video's Captions choice, and only re-renders when a patch switches them",
    async () => {
      const { core, replay, project, video } = await connect({
        revision: [replies("They are on."), submitsPatch({ scenes: [], captions: false, summary: "Turned the Captions off." })],
      });
      const v1Units = await generatedGood(project);
      await core.video.setCaptions({ ...video, captions: true });

      const { ended: answered } = await revise(core, video, "Are Captions on?");
      const { ended } = await revise(core, video, "Turn the Captions off");
      const saved = await readVersion(project, 2);

      expect(answered.state).toBe("answered");
      expect(replay.askedOf("revision")[0]?.message).toContain("Captions are on.");
      expect(ended.units.map(({ rebuild }) => rebuild)).toEqual(["rerender", "rerender", "rerender", "rerender", "rerender"]);
      expect(regenerated(replay)).toEqual([]);
      expect(saved).toMatchObject({ captions: false, units: v1Units });
      expect(await core.video.open(video)).toMatchObject({ version: 2, captions: false });
      await core.project.close({ projectId: project.id });
    },
    RUN_TIMEOUT_MS,
  );

  it("starts one Revision at a time, even for requests sent at once", async () => {
    const { core, project, video } = await connect({ revision: [replies("Sure.")] });
    await generatedGood(project);

    const results = await Promise.allSettled([1, 2].map((n) => core.video.revise({ ...video, message: `Request ${n}`, scope: [] })));

    expect(results.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(results.find(({ status }) => status === "rejected")).toMatchObject({ reason: { code: "REVISING" } });
    await core.project.close({ projectId: project.id });
  }, 60_000);

  it(
    "is discarded by Stop, keeping the current Version",
    async () => {
      const s03 = scene(storyboard, "s03");
      (s03.content.caption as { text: string }).text = "Instant";
      // s03's subagent has no recorded turn: once released, it stops without code to check.
      const { core, replay, project, video } = await connect({ revision: [submitsPatch({ scenes: [s03], summary: "Shortened the stat's caption." })] });
      await generatedGood(project);
      replay.hold("scene-code s03");
      const revision = await watch(core, video);

      await core.video.revise({ ...video, message: "Shorter caption on the stat", scope: [] });
      const writing = await revision.until((status) => unitStatus(status, "s03")?.status === "writing");
      await core.video.stopRevision(video);
      const stopped = await revision.until(({ state }) => state === "stopped");
      replay.release("scene-code s03");
      await expect.poll(() => replay.sessions().open).toBe(0);
      revision.stop();

      expect(writing.affected).toEqual(["s03"]);
      expect(stopped.version).toBeUndefined();
      expect(await versions(project)).toEqual(["1.json"]);
      // The next request starts at once.
      await expect(core.video.revise({ ...video, message: "Again", scope: [] })).resolves.toBeUndefined();
      await core.project.close({ projectId: project.id });
    },
    RUN_TIMEOUT_MS,
  );

  it("is too late to stop once it is saving its Version, and ends done", async () => {
    const s01 = scene(storyboard, "s01");
    s01.transition = { type: "cut" };
    const { core, project, video } = await connect({ revision: [submitsPatch({ scenes: [s01], summary: "Cut into the list." })] });
    await generatedGood(project);
    const revision = await watch(core, video);

    await core.video.revise({ ...video, message: "Cut into the list", scope: [] });
    await revision.until(({ state }) => state === "saving" || state === "done");
    await core.video.stopRevision(video);
    const ended = await revision.until(({ state }) => state === "done" || state === "stopped");
    revision.stop();

    expect(ended).toMatchObject({ state: "done", version: 2 });
    expect(revision.statuses.map(({ state }) => state)).not.toContain("stopped");
    expect(await versions(project)).toEqual(["1.json", "2.json"]);
    await core.project.close({ projectId: project.id });
  }, RUN_TIMEOUT_MS);

  it("needs a generated video, and Scenes it has", async () => {
    const { core, project, video } = await connect({});

    await expect(core.video.revise({ ...video, message: "Faster", scope: [] })).rejects.toMatchObject({ code: "NOT_GENERATED" });
    await generatedGood(project);
    await expect(core.video.revise({ ...video, message: "Faster", scope: ["s09"] })).rejects.toMatchObject({ code: "UNKNOWN_SCENE", data: { sceneId: "s09" } });
    await core.project.close({ projectId: project.id });
  }, 60_000);
});
