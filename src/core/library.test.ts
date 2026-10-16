import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CoreClient, Project } from "../contract";
import { bundledPreset } from "../modules/style";
import { bundledAssetsDir } from "./native";
import { connect, newProject } from "./test-support/generation";
import { voiceover } from "./test-support/media";

/** The Storyboard of the `stacked` Transcript: five lone Scenes, s01 to s05. */
const storyboard = JSON.parse(await readFile(join(import.meta.dirname, "fixtures", "generation", "storyboard.json"), "utf8")) as { scenes: Record<string, unknown>[] };

let root: string;
let core: CoreClient;
let appDataDir: string;
let project: Project;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "motionbrief-library-"));
  const connected = await connect({ root, script: [] });
  core = connected.core;
  appDataDir = join(connected.dir, "app-data");
  project = await newProject(core, root);
});

afterEach(async () => {
  await core.project.close({ projectId: project.id });
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

async function sound(name: string, seconds = 0.3) {
  return voiceover(root, name, [{ tone: seconds }]);
}

/** Saves a Version of the Project's 16:9 video straight into its folder, its first Scene playing `sounds`. */
async function savedVersion(number: number, sounds: string[], extra: Record<string, unknown> = {}) {
  const versions = join(project.path, "horizontal", "versions");
  await mkdir(versions, { recursive: true });
  const [first, ...rest] = storyboard.scenes;
  const version = {
    storyboard: { ...storyboard, scenes: [{ ...first, sounds: sounds.map((asset) => ({ asset, at: 0 })) }, ...rest] },
    preset: bundledPreset("blueprint"),
    captions: false,
    units: {},
    flags: [],
    models: {},
    frameContractVersion: "1.0.0",
    version: number,
    createdAt: "2026-10-04T12:00:00.000Z",
    origin: "generation",
    ...extra,
  };
  await writeFile(join(versions, `${number}.json`), `${JSON.stringify(version, null, 2)}\n`);
}

async function versionFile(number: number) {
  return JSON.parse(await readFile(join(project.path, "horizontal", "versions", `${number}.json`), "utf8")) as Record<string, unknown>;
}

const video = () => ({ projectId: project.id, format: "horizontal" as const });

describe("the bundled set", () => {
  it("lists read-only sound effects as bundled:<slug>, each with a role and notes, and no music", async () => {
    const bundled = await core.assets.list({ scope: "bundled" });

    expect(bundled.length).toBeGreaterThanOrEqual(40);
    expect(bundled.length).toBeLessThanOrEqual(80);
    expect(bundled.every(({ id, kind, notes }) => /^bundled:[a-z0-9-]+$/.test(id) && kind === "sfx" && notes !== "")).toBe(true);
    expect(bundled.find(({ id }) => id === "bundled:zoom-through")).toMatchObject({ name: "Zoom through", role: "transition", format: "opus" });
    expect(bundled.find(({ id }) => id === "bundled:punch")).toMatchObject({ role: "impact" });
    expect(new Set(bundled.map(({ id }) => id)).size).toBe(bundled.length);
    expect(await core.assets.list({ scope: "bundled", kind: "music" })).toEqual([]);
  });

  it("can't be renamed, re-noted or removed", async () => {
    await expect(core.assets.update({ scope: "library", id: "bundled:punch", notes: "Mine now" })).rejects.toMatchObject({ code: "UNKNOWN_ASSET" });
    await expect(core.assets.remove({ scope: "library", id: "bundled:punch" })).rejects.toMatchObject({ code: "UNKNOWN_ASSET" });
    await expect(core.assets.update({ scope: "bundled", id: "bundled:punch", notes: "?" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("ships every listed sound with a provenance entry, under 30 MB", async () => {
    const dir = bundledAssetsDir();
    const bundled = await core.assets.list({ scope: "bundled" });
    const provenance = await readFile(join(dir, "PROVENANCE.md"), "utf8");
    const sizes = await Promise.all((await readdir(dir)).map(async (name) => (await stat(join(dir, name))).size));

    for (const { id } of bundled) {
      const slug = id.replace("bundled:", "");
      expect((await stat(join(dir, `${slug}.opus`))).size).toBeGreaterThan(0);
      expect(provenance).toContain(`| \`${slug}\` |`);
    }

    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThan(30 * 1024 * 1024);
  });
});

describe("the Library", () => {
  it("imports an Asset straight into the Library, shared by every Project, and not into the open one", async () => {
    const whoosh = await core.assets.import({ scope: "library", path: await sound("Whoosh.wav"), name: "Whoosh", kind: "sfx", notes: "My whoosh" });

    expect(await core.assets.list({ scope: "library" })).toEqual([whoosh]);
    expect(await core.assets.list({ scope: "project", projectId: project.id })).toEqual([]);
    expect((await readdir(join(appDataDir, "Library"))).sort()).toEqual([`${whoosh.id}.json`, `${whoosh.id}.wav`]);
  });

  it("renames and re-notes a Library Asset", async () => {
    const whoosh = await core.assets.import({ scope: "library", path: await sound("Whoosh.wav"), name: "Whoosh", kind: "sfx", notes: "" });

    expect(await core.assets.update({ scope: "library", id: whoosh.id, notes: "For pushes" })).toMatchObject({ name: "Whoosh", notes: "For pushes" });
    expect(await core.assets.list({ scope: "library" })).toMatchObject([{ notes: "For pushes" }]);
  });

  it("promotes a Project Asset with Add to Library, keeping what the creator wrote", async () => {
    const path = await sound("Pop.wav");
    const pop = await core.assets.import({ scope: "project", projectId: project.id, path, name: "Pop", kind: "sfx", notes: "For list items" });

    expect(await core.assets.addToLibrary({ projectId: project.id, id: pop.id })).toEqual(pop);
    expect(await core.assets.list({ scope: "library" })).toEqual([pop]);
    expect(await readFile(join(appDataDir, "Library", `${pop.id}.wav`))).toEqual(await readFile(path));
    await expect(core.assets.addToLibrary({ projectId: project.id, id: "f".repeat(64) })).rejects.toMatchObject({ code: "UNKNOWN_ASSET" });
  });

  it("removes a Library Asset without touching any Project's copy", async () => {
    const pop = await core.assets.import({ scope: "project", projectId: project.id, path: await sound("Pop.wav"), name: "Pop", kind: "sfx", notes: "" });
    await core.assets.addToLibrary({ projectId: project.id, id: pop.id });

    await core.assets.remove({ scope: "library", id: pop.id });

    expect(await core.assets.list({ scope: "library" })).toEqual([]);
    expect(await readdir(join(appDataDir, "Library"))).toEqual([]);
    expect(await core.assets.list({ scope: "project", projectId: project.id })).toEqual([pop]);
    expect((await readdir(join(project.path, "assets"))).sort()).toEqual([`${pop.id}.json`, `${pop.id}.wav`]);
  });

  it("answers its folder, for Open Library folder", async () => {
    const folder = await core.assets.libraryFolder();

    expect(folder).toBe(join(appDataDir, "Library"));
    expect((await stat(folder)).isDirectory()).toBe(true);
  });
});

describe("saving a Version", () => {
  it("copies the Library Assets it uses into the Project with their sidecars, so the Project needs no Library", async () => {
    const path = await sound("Whoosh.wav");
    const whoosh = await core.assets.import({ scope: "library", path, name: "Whoosh", kind: "sfx", notes: "My whoosh" });
    await savedVersion(1, [whoosh.id, "bundled:punch"]);

    await core.video.restore({ ...video(), version: 1 });
    await core.assets.remove({ scope: "library", id: whoosh.id });

    expect(await core.assets.list({ scope: "project", projectId: project.id })).toEqual([whoosh]);
    expect(await readFile(join(project.path, "assets", `${whoosh.id}.wav`))).toEqual(await readFile(path));
  });

  it("records the bundled-set version it was saved with", async () => {
    await savedVersion(1, []);

    await core.video.restore({ ...video(), version: 1 });

    expect(await versionFile(2)).toMatchObject({ bundledSet: 1 });
    expect(await versionFile(1)).not.toHaveProperty("bundledSet");
  });
});

describe("removing a Project Asset a Version uses", () => {
  it("hides it from listings but keeps its bytes, so the Version still plays", async () => {
    const pop = await core.assets.import({ scope: "project", projectId: project.id, path: await sound("Pop.wav"), name: "Pop", kind: "sfx", notes: "" });
    await savedVersion(1, [pop.id]);

    await core.assets.remove({ scope: "project", projectId: project.id, id: pop.id });

    expect(await core.assets.list({ scope: "project", projectId: project.id })).toEqual([]);
    expect((await readdir(join(project.path, "assets"))).sort()).toEqual([`${pop.id}.json`, `${pop.id}.wav`]);
  });
});

describe("a Project made with another bundled set", () => {
  it("flags the bundled sounds this app's set lacks", async () => {
    await savedVersion(1, ["bundled:punch", "bundled:from-a-newer-set"], { bundledSet: 2 });

    expect(await core.assets.bundledCheck({ projectId: project.id })).toEqual({ projectSet: 2, appSet: 1, missing: ["from-a-newer-set"] });
  });

  it("reads a Version that records no set as the initial one, which this app has", async () => {
    await savedVersion(1, ["bundled:punch"]);

    expect(await core.assets.bundledCheck({ projectId: project.id })).toEqual({ projectSet: 1, appSet: 1, missing: [] });
  });
});
