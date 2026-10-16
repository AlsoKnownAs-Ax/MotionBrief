import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CoreClient, Project } from "../contract";
import { connect, newProject, sha256 } from "./test-support/generation";
import { picture, video, voiceover } from "./test-support/media";

/** EBU R128 reads anything quieter as silence. */
const SILENCE_LUFS = -70;

let root: string;
let core: CoreClient;
let project: Project;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "motionbrief-assets-"));
  ({ core } = await connect({ root, script: [] }));
  project = await newProject(core, root);
});

afterEach(async () => {
  await core.project.close({ projectId: project.id });
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

function importAsset(asset: { path: string; name: string; kind: "sfx" | "music" | "image" | "logo"; notes?: string }) {
  return core.assets.import({ scope: "project", projectId: project.id, notes: "", ...asset });
}

function assetFiles() {
  return readdir(join(project.path, "assets")).then((names) => names.sort());
}

describe("importing a Project Asset", () => {
  it("copies a sound into the Project as <sha256>.<ext> beside a sidecar of what the creator wrote and what was measured", async () => {
    const path = await voiceover(root, "Pop.wav", [{ tone: 0.5 }]);

    const asset = await importAsset({ path, name: "Pop", kind: "sfx", notes: "A soft pop for list items" });

    const id = sha256(await readFile(path));
    expect(asset).toMatchObject({ id, name: "Pop", kind: "sfx", notes: "A soft pop for list items", format: "wav", duration: 0.5 });
    expect(await assetFiles()).toEqual([`${id}.json`, `${id}.wav`]);
    expect(await readFile(join(project.path, "assets", `${id}.wav`))).toEqual(await readFile(path));
    expect(JSON.parse(await readFile(join(project.path, "assets", `${id}.json`), "utf8"))).toMatchObject({ name: "Pop", kind: "sfx", format: "wav" });
    expect(await core.assets.list({ scope: "project", projectId: project.id })).toEqual([asset]);
  });

  it("gives one Asset for the same file imported twice, with what the creator wrote the second time", async () => {
    const path = await voiceover(root, "Whoosh.flac", [{ tone: 0.8 }]);
    const first = await importAsset({ path, name: "Whoosh", kind: "sfx" });

    const second = await importAsset({ path, name: "Big whoosh", kind: "sfx", notes: "For the reveal" });

    expect(second).toMatchObject({ id: first.id, name: "Big whoosh", notes: "For the reveal", format: "flac" });
    expect(await assetFiles()).toEqual([`${first.id}.flac`, `${first.id}.json`]);
    expect(await core.assets.list({ scope: "project", projectId: project.id })).toEqual([second]);
  });

  it("measures a sound effect shorter than 400 ms at its loudest, so it doesn't read as silence", async () => {
    const path = await voiceover(root, "Tick.wav", [{ tone: 0.2 }]);

    const asset = await importAsset({ path, name: "Tick", kind: "sfx" });

    expect(asset).toMatchObject({ kind: "sfx", duration: 0.2 });
    expect(asset.kind === "sfx" && asset.loudness).toBeGreaterThan(-30);
  });

  it("measures music by its integrated loudness, which a silent bed has none of", async () => {
    const loud = await importAsset({ path: await voiceover(root, "Bed.m4a", [{ tone: 3 }]), name: "Bed", kind: "music" });
    const silent = await importAsset({ path: await voiceover(root, "Quiet.wav", [{ silence: 3 }]), name: "Quiet", kind: "music" });

    expect(loud).toMatchObject({ kind: "music", format: "m4a" });
    expect(loud.kind === "music" && loud.loudness).toBeGreaterThan(-30);
    expect(silent.kind === "music" && silent.loudness).toBe(SILENCE_LUFS);
  });

  it("reads an image's size and whether it has see-through pixels", async () => {
    const logo = await importAsset({ path: await picture(root, "Logo.png", { color: "red@0.0", width: 8, height: 4 }), name: "Logo", kind: "logo", notes: "Our logo" });
    const shot = await importAsset({ path: await picture(root, "Shot.jpg", { width: 16, height: 10 }), name: "Shot", kind: "image", notes: "The dashboard" });

    expect(logo).toMatchObject({ kind: "logo", format: "png", width: 8, height: 4, transparent: true });
    expect(shot).toMatchObject({ kind: "image", format: "jpeg", width: 16, height: 10, transparent: false });
  });

  it("reads an SVG's size from its width and height, or else its viewBox", async () => {
    const sized = join(root, "Sized.svg");
    const boxed = join(root, "Boxed.svg");
    await writeFile(sized, `<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg" width="120px" height="40"><rect/></svg>`);
    await writeFile(boxed, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12"><rect/></svg>`);

    expect(await importAsset({ path: sized, name: "Sized", kind: "logo", notes: "Wordmark" })).toMatchObject({ format: "svg", width: 120, height: 40 });
    expect(await importAsset({ path: boxed, name: "Boxed", kind: "logo", notes: "Mark" })).toMatchObject({ format: "svg", width: 24, height: 12 });
  });

  it("requires notes for images and logos, but not for sounds", async () => {
    const path = await picture(root, "Shot.png");

    await expect(importAsset({ path, name: "Shot", kind: "image", notes: "  " })).rejects.toMatchObject({ code: "NOTES_REQUIRED", data: { kind: "image" } });
    await expect(importAsset({ path, name: "Shot", kind: "logo" })).rejects.toMatchObject({ code: "NOTES_REQUIRED", data: { kind: "logo" } });
    await expect(importAsset({ path: await voiceover(root, "Pop.wav", [{ tone: 0.3 }]), name: "Pop", kind: "sfx" })).resolves.toMatchObject({ notes: "" });
  });

  it("rejects files that aren't a format their kind accepts, saying why, and copies nothing", async () => {
    const text = join(root, "Notes.txt");
    await writeFile(text, "not media");
    const sound = await voiceover(root, "Pop.wav", [{ tone: 0.3 }]);
    const clip = await video(root, "Clip.mp4", { stretches: [{ tone: 1 }] });
    const gif = await picture(root, "Spinner.gif");

    await expect(importAsset({ path: text, name: "Notes", kind: "sfx" })).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT", data: { path: text, kind: "sfx" } });
    await expect(importAsset({ path: clip, name: "Clip", kind: "music" })).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT", data: { kind: "music" } });
    await expect(importAsset({ path: sound, name: "Pop", kind: "image", notes: "?" })).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT", data: { kind: "image" } });
    await expect(importAsset({ path: gif, name: "Spinner", kind: "image", notes: "?" })).rejects.toMatchObject({
      code: "UNSUPPORTED_FORMAT",
      data: { detail: expect.stringContaining("PNG, JPEG, WebP or SVG") },
    });
    await expect(importAsset({ path: sound, name: "Pop", kind: "video" as "sfx" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(assetFiles()).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects images over 20 MB and sounds over 15 minutes", async () => {
    const huge = join(root, "Huge.png");
    await writeFile(huge, Buffer.alloc(20 * 1024 * 1024 + 1));
    const long = await voiceover(root, "Long.flac", [{ silence: 15 * 60 + 1 }]);

    await expect(importAsset({ path: huge, name: "Huge", kind: "image", notes: "Big" })).rejects.toMatchObject({
      code: "ASSET_TOO_LARGE",
      data: { path: huge, bytes: 20 * 1024 * 1024 + 1, maxBytes: 20 * 1024 * 1024 },
    });
    await expect(importAsset({ path: long, name: "Long", kind: "music" })).rejects.toMatchObject({ code: "ASSET_TOO_LONG", data: { path: long, maxSeconds: 900 } });
  }, 30_000);
});

describe("managing Project Assets", () => {
  it("lists Assets by name, optionally of one kind", async () => {
    const pop = await importAsset({ path: await voiceover(root, "Pop.wav", [{ tone: 0.3 }]), name: "Pop", kind: "sfx" });
    const bed = await importAsset({ path: await voiceover(root, "Bed.wav", [{ tone: 1 }]), name: "Bed", kind: "music" });
    const logo = await importAsset({ path: await picture(root, "Logo.png"), name: "Acme", kind: "logo", notes: "Acme's logo" });

    expect(await core.assets.list({ scope: "project", projectId: project.id })).toEqual([logo, bed, pop]);
    expect(await core.assets.list({ scope: "project", projectId: project.id, kind: "music" })).toEqual([bed]);
  });

  it("renames an Asset and rewrites its notes, keeping notes on images and logos", async () => {
    const logo = await importAsset({ path: await picture(root, "Logo.png"), name: "Logo", kind: "logo", notes: "Our logo" });

    const renamed = await core.assets.update({ scope: "project", projectId: project.id, id: logo.id, name: "Acme" });
    const renoted = await core.assets.update({ scope: "project", projectId: project.id, id: logo.id, notes: "Acme's logo, for the outro" });

    expect(renamed).toMatchObject({ name: "Acme", notes: "Our logo", width: 4 });
    expect(renoted).toMatchObject({ name: "Acme", notes: "Acme's logo, for the outro" });
    expect(await core.assets.list({ scope: "project", projectId: project.id })).toEqual([renoted]);
    await expect(core.assets.update({ scope: "project", projectId: project.id, id: logo.id, notes: "" })).rejects.toMatchObject({ code: "NOTES_REQUIRED" });
    await expect(core.assets.update({ scope: "project", projectId: project.id, id: logo.id, name: " " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("removes an Asset no Version uses: it leaves the listings and its bytes are deleted", async () => {
    const pop = await importAsset({ path: await voiceover(root, "Pop.wav", [{ tone: 0.3 }]), name: "Pop", kind: "sfx" });
    const bed = await importAsset({ path: await voiceover(root, "Bed.wav", [{ tone: 1 }]), name: "Bed", kind: "music" });

    await core.assets.remove({ scope: "project", projectId: project.id, id: pop.id });

    expect(await core.assets.list({ scope: "project", projectId: project.id })).toEqual([bed]);
    expect(await assetFiles()).toEqual([`${bed.id}.json`, `${bed.id}.wav`]);
    await expect(core.assets.remove({ scope: "project", projectId: project.id, id: pop.id })).rejects.toMatchObject({ code: "UNKNOWN_ASSET", data: { id: pop.id } });
  });

  it("refuses ids that aren't one of the Project's Assets, and Projects that aren't open", async () => {
    await expect(core.assets.update({ scope: "project", projectId: project.id, id: "../project", name: "x" })).rejects.toMatchObject({ code: "UNKNOWN_ASSET" });
    await expect(core.assets.list({ scope: "project", projectId: "nope" })).rejects.toMatchObject({ code: "UNKNOWN_PROJECT" });
  });
});
