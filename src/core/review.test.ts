import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CoreClient, GenerationStatus, Project, UnitCode } from "../contract";
import { connect, generate, newProject, storyboard, submitsCode, submitsReview, submitsStoryboard, unitCode } from "./test-support/generation";

// Every unit is checked and drawn in the pinned chrome-headless-shell, each taking seconds.
const RUN_TIMEOUT_MS = 300_000;

const CROWDED = "The kicker crowds the headline.";
const TOO_SMALL = "The number is too small to read.";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "motionbrief-review-"));
});

afterAll(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));

describe("visual review and repair", () => {
  let core: CoreClient;
  let replay: Awaited<ReturnType<typeof connect>>["replay"];
  let dir: string;
  let project: Project;
  let done: GenerationStatus;

  beforeAll(async () => {
    const script = {
      storyboard: [submitsStoryboard(storyboard)],
      // Passes, is found crowded, and its repair passes too: the repair is kept.
      "scene-code s01": [submitsCode(await unitCode("good", "s01")), submitsCode(await unitCode("repaired", "s01"))],
      "review s01": [submitsReview({ looksRight: false, problems: ["s01-kicker sits too close to s01-headline; give them more room."], note: CROWDED })],
      // Passes, but its repair brings in a raw color the checks reject: the passing code comes back with a review note.
      "scene-code s03": [submitsCode(await unitCode("good", "s03")), submitsCode(await unitCode("raw-color", "s03"))],
      "review s03": [submitsReview({ looksRight: false, problems: ["s03-trips is too small for a hero number."], note: TOO_SMALL })],
      // Passes and looks right: no repair.
      "scene-code s04": [submitsCode(await unitCode("good", "s04"))],
      "review s04": [submitsReview({ looksRight: true, problems: [], note: "" })],
      // s02 and s05 have no recorded code, so they become fallback Scenes without a review.
    };
    ({ core, replay, dir } = await connect({ root, script }));
    project = await newProject(core, dir);
    done = await generate(core, { projectId: project.id, format: "horizontal" });
  }, RUN_TIMEOUT_MS);

  afterAll(() => core?.project.close({ projectId: project.id }));

  async function version() {
    return JSON.parse(await readFile(join(project.path, "horizontal", "versions", "1.json"), "utf8")) as {
      units: Record<string, string>;
      flags: unknown[];
      models: Record<string, string>;
    };
  }

  async function storedUnit(hash: string | undefined): Promise<UnitCode> {
    return JSON.parse(await readFile(join(project.path, "horizontal", "units", `${hash}.json`), "utf8")) as UnitCode;
  }

  it("reviews each unit that passes the checks once, on the visual review's own model", async () => {
    expect(done.state).toBe("done");
    expect(["s01", "s02", "s03", "s04", "s05"].map((unit) => replay.askedOf(`review ${unit}`).length)).toEqual([1, 0, 1, 1, 0]);
    expect(replay.askedOf("review s01")[0]?.options.model).toBe("claude-sonnet-5-5");
    expect((await version()).models).toMatchObject({ review: "claude-sonnet-5-5" });
  });

  it("draws the reviewed units' stills with the Renderer and keeps them in the cache by content hash", async () => {
    const stills = await readdir(join(dir, "cache", "stills"));

    // Each reviewed lone Scene halfway through and just before it ends.
    expect(stills.filter((file) => /^[0-9a-f]{32}\.jpg$/.test(file))).toHaveLength(6);
  });

  it("keeps a repair that passes the checks", async () => {
    expect(replay.askedOf("scene-code s01")).toHaveLength(2);
    expect(done.units.find(({ id }) => id === "s01")).toEqual({ id: "s01", status: "ready", attempts: 2 });
    expect(await storedUnit((await version()).units.s01)).toEqual(await unitCode("repaired", "s01"));
  });

  it("reverts a repair that fails the checks to the passing code, with the reviewer's sentence as a review note in the Version", async () => {
    const saved = await version();

    expect(replay.askedOf("scene-code s03")).toHaveLength(2);
    expect(done.units.find(({ id }) => id === "s03")).toEqual({ id: "s03", status: "flagged", attempts: 2 });
    expect(await storedUnit(saved.units.s03)).toEqual(await unitCode("good", "s03"));
    expect(saved.flags).toEqual([
      { unit: "s02", kind: "fallback", reason: expect.any(String) },
      { unit: "s03", kind: "review-note", reason: TOO_SMALL },
      { unit: "s05", kind: "fallback", reason: expect.any(String) },
    ]);
  });

  it("shows a reverted repair's Scene with the reviewer's sentence", () => {
    const scenes = done.preview?.timeline.scenes.map(({ id, status, note }) => ({ id, status, note }));

    expect(scenes).toEqual([
      { id: "s01", status: "ready" },
      { id: "s02", status: "fallback" },
      { id: "s03", status: "flagged", note: TOO_SMALL },
      { id: "s04", status: "ready" },
      { id: "s05", status: "fallback" },
    ]);
  });

  it("repairs nothing that looks right", () => {
    expect(replay.askedOf("scene-code s04")).toHaveLength(1);
    expect(done.units.find(({ id }) => id === "s04")).toEqual({ id: "s04", status: "ready", attempts: 1 });
  });
});
