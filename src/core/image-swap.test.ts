import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CoreClient, Project, RevisionStatus, UnitCode, VideoRef } from "../contract";
import { BROWSER_TIMEOUT_MS } from "./test-support/checker";
import { connect, follow, generate, newProject, sha256, storyboard as stacked, submitsCode, submitsStoryboard, unitCode } from "./test-support/generation";
import { picture } from "./test-support/media";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "motionbrief-image-swap-"));
});

afterAll(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));

/** `good` s01, also showing the hook's media: the image `id`. */
async function withShot(id: string): Promise<UnitCode> {
  const good = await unitCode("good", "s01");

  return {
    css: `${good.css}\n.shot { width: 640px; height: 400px; }`,
    html: good.html.replace(/<\/div>\s*$/, `  <img id="s01-shot" class="shot" src="asset(${id})">\n</div>\n`),
    js: `${good.js}\nMB.reveal(tl, "#s01-shot", at("s01-shot"), "pop");`,
  };
}

const ENDED = new Set(["answered", "done", "failed", "stopped"]);

// A swap re-renders or regenerates units, checking each in the pinned chrome-headless-shell.
const RUN_TIMEOUT_MS = 300_000;

describe("swapping an image in a Scene", () => {
  let core: CoreClient;
  let project: Project;
  let replay: Awaited<ReturnType<typeof connect>>["replay"];
  let video: VideoRef;
  const ids: Record<"shot" | "similar" | "wide" | "logo", string> = { shot: "", similar: "", wide: "", logo: "" };

  /** Swaps the hook's media for `asset`, and waits for the run it starts to end. */
  async function swap(asset: string, confirmed?: boolean): Promise<RevisionStatus> {
    const revision = await follow((signal) => core.video.revision(video, { signal }));
    // The stream starts with the last run's status; this swap's are the ones after it.
    const before = revision.items.length;
    await core.video.swapAsset({ ...video, sceneId: "s01", field: "content.media.asset", asset, confirmed });
    const ended = await revision.until((status) => revision.items.indexOf(status) >= before && ENDED.has(status.state));
    revision.stop();

    return ended;
  }

  async function readVersion(number: number) {
    return JSON.parse(await readFile(join(project.path, "horizontal", "versions", `${number}.json`), "utf8")) as {
      storyboard: { scenes: { id: string; content: { media?: { asset: string } } }[] };
      units: Record<string, string>;
    };
  }

  async function savedCode(hash: string): Promise<UnitCode> {
    return JSON.parse(await readFile(join(project.path, "horizontal", "units", `${hash}.json`), "utf8")) as UnitCode;
  }

  beforeAll(async () => {
    const dir = await mkdtemp(join(root, "swap-"));
    const files = {
      shot: await picture(dir, "Dashboard.png", { width: 16, height: 10 }),
      similar: await picture(dir, "Billing.png", { color: "blue", width: 17, height: 10 }),
      wide: await picture(dir, "Banner.png", { color: "green", width: 4, height: 2 }),
      logo: await picture(dir, "Acme.png", { color: "red@0.0", width: 16, height: 10 }),
    };

    for (const [name, path] of Object.entries(files)) {
      ids[name as keyof typeof ids] = sha256(await readFile(path));
    }

    const [first, ...rest] = stacked.scenes as unknown as { content: object }[];
    const storyboard = { ...stacked, scenes: [{ ...first, content: { ...first!.content, media: { id: "shot", asset: ids.shot, at: 7 } } }, ...rest] };
    ({ core, replay } = await connect({
      root: dir,
      script: {
        storyboard: [submitsStoryboard(storyboard)],
        "scene-code s01": [submitsCode(await withShot(ids.shot)), submitsCode(await withShot(ids.wide))],
        ...Object.fromEntries(await Promise.all(["s02", "s03", "s04"].map(async (unit) => [`scene-code ${unit}`, [submitsCode(await unitCode("good", unit))]] as const))),
      },
    }));
    project = await newProject(core, dir);
    video = { projectId: project.id, format: "horizontal" };

    for (const [name, path] of Object.entries(files)) {
      const kind = name === "logo" ? "logo" : "image";
      await core.assets.import({ scope: "project", projectId: project.id, path, name, kind, notes: `The ${name}` });
    }

    await generate(core, video);
  }, BROWSER_TIMEOUT_MS * 2);

  afterAll(() => core.project.close({ projectId: project.id }));

  it(
    "only re-renders a swap for an image of the same kind within about 15% aspect, with no agent run",
    async () => {
      const done = await swap(ids.similar);
      const saved = await readVersion(2);

      expect(done).toMatchObject({ state: "done", version: 2 });
      expect(done.units).toEqual([expect.objectContaining({ id: "s01", rebuild: "rerender", status: "ready" })]);
      expect(replay.askedOf("scene-code s01")).toHaveLength(1);
      expect(saved.storyboard.scenes[0]?.content.media?.asset).toBe(ids.similar);
      expect((await savedCode(saved.units.s01!)).html).toContain(`src="asset(${ids.similar})"`);
    },
    RUN_TIMEOUT_MS,
  );

  it("asks for confirmation before a swap that regenerates: another aspect, or another kind", async () => {
    for (const asset of [ids.wide, ids.logo]) {
      await expect(core.video.swapAsset({ ...video, sceneId: "s01", field: "content.media.asset", asset })).rejects.toMatchObject({
        code: "SWAP_UNCONFIRMED",
        data: { scenes: ["s01"] },
      });
    }

    expect(replay.askedOf("scene-code s01")).toHaveLength(1);
  });

  it(
    "regenerates the unit once the swap is confirmed",
    async () => {
      const done = await swap(ids.wide, true);
      const saved = await readVersion(3);

      expect(done).toMatchObject({ state: "done", version: 3 });
      expect(done.units).toEqual([expect.objectContaining({ id: "s01", rebuild: "regenerate", status: "ready" })]);
      expect(replay.askedOf("scene-code s01")).toHaveLength(2);
      expect(saved.storyboard.scenes[0]?.content.media?.asset).toBe(ids.wide);
    },
    RUN_TIMEOUT_MS,
  );

  it("rejects a swap the Scene can't show, such as a logo's place given to an unknown Asset", async () => {
    await expect(core.video.swapAsset({ ...video, sceneId: "s01", field: "content.media.asset", asset: "f".repeat(64), confirmed: true })).rejects.toMatchObject({
      code: "INVALID_SWAP",
    });
    await expect(core.video.swapAsset({ ...video, sceneId: "s01", field: "content.headline", asset: ids.shot })).rejects.toMatchObject({ code: "INVALID_SWAP" });
  });

  it("shows each Scene's Assets in the timeline, by field", async () => {
    const opened = await core.video.open(video);

    expect(opened.preview?.timeline.scenes[0]?.assets).toEqual([{ field: "content.media.asset", id: ids.wide }]);
    expect(opened.preview?.timeline.scenes[1]?.assets).toBeUndefined();
  });
});
