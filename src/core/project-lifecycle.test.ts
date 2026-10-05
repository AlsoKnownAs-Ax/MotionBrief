import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import { createRouterClient } from "@orpc/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CoreClient } from "../contract";
import { createCore } from "./composition-root";
import { serveCore } from "./serve";
import { voiceover } from "./test-support/media";
import { fakeWhisper, whisperFixture } from "./test-support/whisper";

/** The kind of folder link each platform makes without admin rights; a directory symlink where it isn't listed. */
const LINK_TYPES: Partial<Record<NodeJS.Platform, "junction" | "dir">> = { win32: "junction" };

let shared: string;
/** A short Voiceover, made once: FFmpeg takes a while. */
let sourceVoiceover: string;

let root: string;
let appDataDir: string;
let projectsDir: string;
let elsewhere: string;
let trashDir: string;
let cores: ReturnType<typeof createCore>[];

beforeAll(async () => {
  shared = await mkdtemp(join(tmpdir(), "motionbrief-lifecycle-shared-"));
  sourceVoiceover = await voiceover(shared, "Intro.wav", [{ tone: 3 }]);
});

afterAll(async () => {
  await rm(shared, { recursive: true, force: true, maxRetries: 5 });
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "motionbrief-lifecycle-"));
  appDataDir = join(root, "app-data");
  projectsDir = join(root, "Documents", "MotionBrief");
  elsewhere = join(root, "Dropbox", "Talks");
  trashDir = join(root, "Trash");
  await Promise.all([mkdir(elsewhere, { recursive: true }), mkdir(trashDir)]);
  cores = [];
});

afterEach(async () => {
  await Promise.all(cores.map((core) => core.shutdown()));
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

type StartOptions = { appVersion?: string };

/** A core on the shared folders, as the app starts it; starting another is what an app restart looks like. */
async function start({ appVersion = "1.2.3" }: StartOptions = {}) {
  const core = createCore({
    appVersion,
    appDataDir,
    projectsDir,
    cacheDir: join(root, "cache"),
    adapters: { whisper: fakeWhisper(await whisperFixture("two-chunks", 2)) },
    trash: async (path) => {
      await rename(path, join(trashDir, basename(path)));
    },
  });
  cores.push(core);

  return {
    ...core,
    /** The core API as one window sees it. */
    window: (connection: string): CoreClient => createRouterClient(core.router, { context: { connection } }),
  };
}

/** Creates a Project through New Project, then leaves it, so it is closed like any Project on Home. */
async function createProject(window: CoreClient, input: { name?: string; folder?: string } = {}) {
  const project = await window.project.create({ voiceoverPath: sourceVoiceover, ...input });
  await window.project.close({ projectId: project.id });

  return project;
}

async function documentOf(path: string) {
  return JSON.parse(await readFile(join(path, "project.json"), "utf8")) as Record<string, unknown>;
}

async function lockOf(path: string) {
  return readFile(join(path, ".lock"), "utf8").then(JSON.parse, () => undefined) as Promise<unknown>;
}

/** A pid no process has any more. */
async function deadPid() {
  const child = spawn(process.execPath, ["-e", ""]);
  await new Promise((resolve) => child.once("exit", resolve));

  return child.pid ?? 0;
}

/** A Project folder as the first schema wrote it, before the app recorded its version in it. */
async function writeSchemaOneProject(dir: string) {
  await mkdir(dir, { recursive: true });
  await cp(sourceVoiceover, join(dir, "voiceover.wav"));
  const document = {
    schemaVersion: 1,
    id: "0b9e0d6e-4bb6-4c86-9a4a-3c1d1f0b7a11",
    createdAt: "2026-09-01T10:00:00.000Z",
    voiceover: { file: "voiceover.wav", fileName: "Intro.wav", sha256: "ab".repeat(32), bytes: 96_078, duration: 3, isVideo: false },
    format: "vertical",
    stylePreset: "terminal",
    language: "en",
    transcript: { language: "en", duration: 3, words: [{ text: "Hello", start: 0.2, end: 0.6 }] },
  };
  const text = `${JSON.stringify(document, null, 2)}\n`;
  await writeFile(join(dir, "project.json"), text);

  return text;
}

// FFmpeg probes a real Voiceover for every Project created, so tests take a second or two.
describe("Project lifecycle", { timeout: 30_000 }, () => {
  describe("recent Projects", () => {
    it("lists the default folder's Projects and those opened from elsewhere, with their Formats, length, Versions, size and modified time", async () => {
      const app = await start();
      const window = app.window("w1");
      const intro = await createProject(window, { name: "Intro" });
      const talk = await createProject(window, { name: "Talk", folder: elsewhere });
      // Generated videos: one folder per Format, holding its Version manifests.
      await mkdir(join(intro.path, "horizontal", "versions"), { recursive: true });
      await writeFile(join(intro.path, "horizontal", "versions", "1.json"), "{}");
      await writeFile(join(intro.path, "horizontal", "versions", "2.json"), "{}");
      await mkdir(join(intro.path, "vertical", "versions"), { recursive: true });
      await writeFile(join(intro.path, "vertical", "versions", "1.json"), "{}");
      const touched = new Date("2030-01-02T03:04:05.000Z");
      await utimes(join(intro.path, "vertical", "versions", "1.json"), touched, touched);

      const projects = await window.project.list();

      expect(projects.map(({ name }) => name)).toEqual(["Intro", "Talk"]);
      expect(projects[0]).toEqual({
        path: intro.path,
        name: "Intro",
        formats: ["horizontal", "vertical"],
        duration: intro.voiceover.duration,
        versions: 3,
        bytes: (await stat(join(intro.path, "project.json"))).size + intro.voiceover.bytes + 6,
        modifiedAt: touched.getTime(),
      });
      // Before its first video, a Project shows the Format it will be generated in.
      expect(projects[1]).toMatchObject({ path: talk.path, formats: ["horizontal"], versions: 0, location: elsewhere });
    });

    it("remembers Projects opened from any folder across restarts, and forgets them once they are gone", async () => {
      const first = await start();
      const outside = join(elsewhere, "Shared talk");
      await writeSchemaOneProject(outside);

      await first.window("w1").project.open({ path: outside });
      const restarted = await start();

      expect((await restarted.window("w1").project.list()).map(({ path }) => path)).toEqual([outside]);

      await rm(outside, { recursive: true });

      expect(await restarted.window("w1").project.list()).toEqual([]);
    });

    it("refuses a folder that isn't a Project", async () => {
      const app = await start();

      await expect(app.window("w1").project.open({ path: elsewhere })).rejects.toMatchObject({ code: "NOT_A_PROJECT", data: { path: elsewhere } });
    });
  });

  describe("opening", () => {
    it("opens a Project folder from anywhere, takes its lock and carries on where it was", async () => {
      const app = await start();
      const window = app.window("w1");
      const created = await createProject(window, { folder: elsewhere });

      const { project } = await window.project.open({ path: created.path });

      expect(project).toEqual(created);
      expect(await lockOf(created.path)).toEqual({ host: hostname(), pid: process.pid });
      expect(await window.project.transcription({ projectId: project.id }).then((stream) => stream.next())).toMatchObject({
        value: { state: "waiting-for-model" },
      });
    });

    it("keeps one open Project per window: opening another closes the first", async () => {
      const app = await start();
      const window = app.window("w1");
      const a = await createProject(window, { name: "A" });
      const b = await createProject(window, { name: "B" });

      await window.project.open({ path: a.path });
      await window.project.open({ path: b.path });

      expect(await lockOf(a.path)).toBeUndefined();
      expect(await lockOf(b.path)).toBeDefined();
      await expect(window.project.update({ projectId: a.id, format: "vertical" })).rejects.toMatchObject({ code: "UNKNOWN_PROJECT" });
    });

    it("refuses a Project open in another window", async () => {
      const app = await start();
      const created = await createProject(app.window("w1"));
      await app.window("w1").project.open({ path: created.path });

      await expect(app.window("w2").project.open({ path: created.path })).rejects.toMatchObject({ code: "ALREADY_OPEN" });
      await expect(app.window("w2").project.open({ path: created.path, force: true })).rejects.toMatchObject({ code: "ALREADY_OPEN" });
    });

    it("lets only one of two windows opening a Project at the same moment have it", async () => {
      const app = await start();
      const created = await createProject(app.window("setup"));

      const results = await Promise.allSettled([
        app.window("w1").project.open({ path: created.path }),
        app.window("w2").project.open({ path: created.path }),
      ]);

      expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect(results.find(({ status }) => status === "rejected")).toMatchObject({ reason: { code: "ALREADY_OPEN" } });
    });

    it("knows a Project reached through a junction or symlink is the same Project", async () => {
      const app = await start();
      const created = await createProject(app.window("w1"));
      const alias = join(elsewhere, "Alias");
      // A junction needs no admin rights on Windows; elsewhere it is a plain directory symlink.
      await symlink(created.path, alias, LINK_TYPES[process.platform] ?? "dir");
      await app.window("w1").project.open({ path: created.path });

      await expect(app.window("w2").project.open({ path: alias })).rejects.toMatchObject({ code: "ALREADY_OPEN" });
      await expect(app.window("w2").project.delete({ path: alias })).rejects.toMatchObject({ code: "ALREADY_OPEN" });
    });

    it("releases a window's Project when the window goes, and every lock when the app quits", async () => {
      const app = await start();
      const a = await createProject(app.window("w1"), { name: "A" });
      const b = await createProject(app.window("w2"), { name: "B" });
      await app.window("w1").project.open({ path: a.path });
      await app.window("w2").project.open({ path: b.path });

      await app.disconnect("w1");

      expect(await lockOf(a.path)).toBeUndefined();
      expect(await lockOf(b.path)).toBeDefined();

      await app.shutdown();

      expect(await lockOf(b.path)).toBeUndefined();
    });

    it("knows each window by its port, and releases its Project when the port closes", async () => {
      const app = await start();
      const created = await createProject(app.window("setup"));
      const { port1, port2 } = new MessageChannel();
      serveCore(app, port1);
      const window: CoreClient = createORPCClient(new RPCLink({ port: port2 }));
      port2.start();

      await window.project.open({ path: created.path });
      await expect(app.window("other").project.open({ path: created.path })).rejects.toMatchObject({ code: "ALREADY_OPEN" });
      port2.close();

      await expect.poll(() => lockOf(created.path)).toBeUndefined();
    });
  });

  describe("lock", () => {
    it("asks before opening a Project another running MotionBrief on this computer holds", async () => {
      const app = await start();
      const created = await createProject(app.window("w1"));
      await writeFile(join(created.path, ".lock"), JSON.stringify({ host: hostname(), pid: process.ppid }));

      await expect(app.window("w1").project.open({ path: created.path })).rejects.toMatchObject({
        code: "PROJECT_LOCKED",
        data: { path: created.path, name: created.name, host: hostname(), isThisComputer: true, isStale: false },
      });
    });

    it.each([
      ["left by a MotionBrief that quit unexpectedly", async () => ({ host: hostname(), pid: await deadPid() }), true],
      ["held by another computer, as a synced folder can be", async () => ({ host: "studio-mac", pid: 4242 }), false],
    ])("calls a lock %s stale, and opens anyway when asked", async (_case, lock, isThisComputer) => {
      const app = await start();
      const window = app.window("w1");
      const created = await createProject(window);
      await writeFile(join(created.path, ".lock"), JSON.stringify(await lock()));
      const lockedAt = (await stat(join(created.path, ".lock"))).mtimeMs;

      await expect(window.project.open({ path: created.path })).rejects.toMatchObject({
        code: "PROJECT_LOCKED",
        data: { isThisComputer, isStale: true, lockedAt },
      });

      const { project } = await window.project.open({ path: created.path, force: true });

      expect(project.id).toBe(created.id);
      expect(await lockOf(created.path)).toEqual({ host: hostname(), pid: process.pid });
    });
  });

  describe("duplicates", () => {
    it("Duplicate copies the folder beside it, and the copy gets its own id the first time it is opened", async () => {
      const app = await start();
      const window = app.window("w1");
      const original = await createProject(window, { name: "Intro" });

      const copy = await window.project.duplicate({ path: original.path });

      expect(copy).toMatchObject({ name: "Intro copy", path: join(projectsDir, "Intro copy") });
      expect((await readdir(copy.path)).sort()).toEqual([".duplicate", "project.json", "voiceover.wav"]);
      expect((await documentOf(copy.path)).id).toBe(original.id);
      expect((await window.project.duplicate({ path: original.path })).name).toBe("Intro copy 2");

      const { project: opened } = await window.project.open({ path: copy.path });

      expect(opened.id).not.toBe(original.id);
      expect((await documentOf(copy.path)).id).toBe(opened.id);
      expect(await readdir(copy.path)).not.toContain(".duplicate");
      const { project: reopenedOriginal } = await window.project.open({ path: original.path });
      expect(reopenedOriginal.id).toBe(original.id);
    });

    it("gives a duplicate its own id even when its original was never opened here", async () => {
      const app = await start();
      const window = app.window("w1");
      const original = join(projectsDir, "Synced talk");
      await writeSchemaOneProject(original);
      const { id } = await documentOf(original);

      const copy = await window.project.duplicate({ path: original });
      const { project: opened } = await window.project.open({ path: copy.path });

      expect(opened.id).not.toBe(id);
      expect((await window.project.open({ path: original })).project.id).toBe(id);
    });

    it("gives a folder copied outside the app its own id, but keeps the id of a moved Project", async () => {
      const app = await start();
      const window = app.window("w1");
      const original = await createProject(window, { name: "Intro" });
      const copied = join(elsewhere, "Intro");
      await cp(original.path, copied, { recursive: true });

      expect((await window.project.open({ path: copied })).project.id).not.toBe(original.id);

      const moved = join(elsewhere, "Intro moved");
      await rename(original.path, moved);

      expect((await window.project.open({ path: moved })).project.id).toBe(original.id);
    });
  });

  describe("schema versions", () => {
    it("migrates an older Project forward after backing up its old files", async () => {
      const app = await start({ appVersion: "1.4.0" });
      const dir = join(projectsDir, "Old talk");
      const oldText = await writeSchemaOneProject(dir);

      const { project, backupPath } = await app.window("w1").project.open({ path: dir });

      expect(project).toMatchObject({ name: "Old talk", format: "vertical", stylePreset: "terminal", language: "en" });
      expect(await documentOf(dir)).toMatchObject({ schemaVersion: 2, appVersion: "1.4.0", id: "0b9e0d6e-4bb6-4c86-9a4a-3c1d1f0b7a11" });
      expect(backupPath).toMatch(/^backups[\\/]schema 1 /);
      expect(await readFile(join(dir, backupPath ?? "", "project.json"), "utf8")).toBe(oldText);
      // The Transcript came across: it isn't transcribed again.
      const status = await app.window("w1").project.transcription({ projectId: project.id }).then((stream) => stream.next());
      expect(status.value).toMatchObject({ state: "done", words: [{ text: "Hello" }] });
    });

    it("never backs up a Project that is already current", async () => {
      const app = await start();
      const created = await createProject(app.window("w1"));

      const { backupPath } = await app.window("w1").project.open({ path: created.path });

      expect(backupPath).toBeUndefined();
      expect(await readdir(created.path)).not.toContain("backups");
    });

    it("refuses a Project saved by a newer MotionBrief, changing nothing", async () => {
      const newer = await start({ appVersion: "9.0.0" });
      const created = await createProject(newer.window("w1"));
      const document = { ...(await documentOf(created.path)), schemaVersion: 99, somethingNew: true };
      await writeFile(join(created.path, "project.json"), JSON.stringify(document));
      const before = await readdir(created.path);

      const older = await start({ appVersion: "1.2.3" });

      await expect(older.window("w1").project.open({ path: created.path })).rejects.toMatchObject({
        code: "PROJECT_TOO_NEW",
        data: { path: created.path, name: created.name, appVersion: "9.0.0" },
      });
      expect(await readdir(created.path)).toEqual(before);
      expect(await documentOf(created.path)).toEqual(document);
    });
  });

  describe("row menu", () => {
    it("Rename renames the folder of a closed Project", async () => {
      const app = await start();
      const window = app.window("w1");
      const created = await createProject(window, { name: "Take 3", folder: elsewhere });

      const renamed = await window.project.rename({ path: created.path, name: "Caching explained" });

      expect(renamed).toMatchObject({ name: "Caching explained", path: join(elsewhere, "Caching explained"), location: elsewhere });
      expect(await readdir(elsewhere)).toEqual(["Caching explained"]);
      expect((await window.project.list()).map(({ path }) => path)).toEqual([renamed.path]);
      await expect(window.project.rename({ path: renamed.path, name: "a/b" })).rejects.toMatchObject({ code: "INVALID_NAME" });
    });

    it("won't rename or delete a Project open in another window", async () => {
      const app = await start();
      const created = await createProject(app.window("w1"));
      await app.window("w1").project.open({ path: created.path });

      await expect(app.window("w2").project.rename({ path: created.path, name: "Other" })).rejects.toMatchObject({ code: "ALREADY_OPEN" });
      await expect(app.window("w2").project.delete({ path: created.path })).rejects.toMatchObject({ code: "ALREADY_OPEN" });
    });

    it.each([
      ["another computer", async () => ({ host: "studio-mac", pid: 4242 })],
      ["a MotionBrief that quit unexpectedly", async () => ({ host: hostname(), pid: await deadPid() })],
    ])("asks before renaming or deleting a Project locked by %s", async (_case, lock) => {
      const app = await start();
      const window = app.window("w1");
      const created = await createProject(window, { name: "Synced" });
      await writeFile(join(created.path, ".lock"), JSON.stringify(await lock()));

      await expect(window.project.rename({ path: created.path, name: "Other" })).rejects.toMatchObject({ code: "PROJECT_LOCKED" });
      await expect(window.project.delete({ path: created.path })).rejects.toMatchObject({ code: "PROJECT_LOCKED" });
      expect(await readdir(projectsDir)).toEqual(["Synced"]);

      const renamed = await window.project.rename({ path: created.path, name: "Other", force: true });
      await window.project.delete({ path: renamed.path, force: true });

      expect(await readdir(trashDir)).toEqual(["Other"]);
    });

    it("won't rename or delete a folder that isn't a Project, even with a project.json", async () => {
      const app = await start();
      const window = app.window("w1");
      const folder = join(elsewhere, "Not a Project");
      await mkdir(folder);
      await writeFile(join(folder, "project.json"), JSON.stringify({ schemaVersion: 1 }));

      await expect(window.project.rename({ path: folder, name: "Renamed" })).rejects.toMatchObject({ code: "NOT_A_PROJECT" });
      await expect(window.project.delete({ path: folder, force: true })).rejects.toMatchObject({ code: "NOT_A_PROJECT" });
      expect(await readdir(elsewhere)).toEqual(["Not a Project"]);
      expect(await readdir(trashDir)).toEqual([]);
    });

    it("Delete moves the folder to the Trash and off the list", async () => {
      const app = await start();
      const window = app.window("w1");
      const created = await createProject(window, { name: "Intro" });

      await window.project.delete({ path: created.path });

      expect(await readdir(trashDir)).toEqual(["Intro"]);
      expect(await window.project.list()).toEqual([]);
    });
  });
});
