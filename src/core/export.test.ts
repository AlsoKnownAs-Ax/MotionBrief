import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ExportStatus, UnitCode, VideoRef, VideoSource } from "../contract";
import storyboard from "./fixtures/checker/storyboard.json";
import { createCore } from "./composition-root";
import transcript from "./fixtures/checker/transcript.json";
import { ffprobePath } from "./native";
import { BLUEPRINT, connect, RULES } from "./test-support/checker";
import { silentWav } from "./test-support/voiceover";

/** An export renders every frame in the pinned browser and encodes with the pinned FFmpeg. */
const EXPORT_TIMEOUT_MS = 180_000;

/** A video of a Project no core has open. */
const UNOPENED: VideoRef = { projectId: "0f8c2a51-export-test", format: "horizontal" };

/** The Checker's passing Scene code for both units of its 8.2 s fixture. */
async function goodCode(): Promise<Record<string, UnitCode>> {
  const unit = async (id: string) => {
    const [css, html, js] = await Promise.all(["css", "html", "js"].map((part) => readFile(join(import.meta.dirname, "fixtures", "checker", "good", `${id}.${part}`), "utf8")));

    return { css: css ?? "", html: html ?? "", js: js ?? "" };
  };

  return { s01: await unit("s01"), s02: await unit("s02") };
}

let workDir = "";
let voiceover = "";
/** Closes the Projects the tests opened, releasing their locks. */
const closers: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "motionbrief-export-"));
  voiceover = join(workDir, "Voiceover.wav");
  await writeFile(voiceover, silentWav());
});

afterAll(async () => {
  await Promise.all(closers.map((close) => close()));
  await rm(workDir, { recursive: true, force: true, maxRetries: 5 });
});

async function source(): Promise<VideoSource> {
  return { storyboard, transcript, rules: RULES, preset: BLUEPRINT, code: await goodCode(), voiceover };
}

/** A core with its own app data folder, and the video open in its player. */
async function openPreview(options: Parameters<typeof connect>[0] = {}) {
  const appDataDir = await mkdtemp(join(workDir, "app-data-"));
  const cacheDir = join(appDataDir, "cache");
  const client = connect({ appDataDir, cacheDir, ...options });
  const preview = await client.preview.open(await source());

  return { client, cacheDir, previewId: preview.id };
}

/** The same, as the horizontal video of a Project the core has open. */
async function openVideo(options: Parameters<typeof connect>[0] = {}) {
  const opened = await openPreview(options);
  const project = await opened.client.project.create({ voiceoverPath: voiceover, format: "horizontal" });
  closers.push(() => opened.client.project.close({ projectId: project.id }));
  const video: VideoRef = { projectId: project.id, format: "horizontal" };

  return { ...opened, projectDir: project.path, video };
}

async function collect(statuses: AsyncIterable<ExportStatus>): Promise<ExportStatus[]> {
  const seen: ExportStatus[] = [];

  for await (const status of statuses) {
    seen.push(status);
  }

  return seen;
}

type Probe = { format: { duration: string }; streams: { codec_type: string; codec_name: string; width?: number; height?: number }[] };

async function probe(file: string): Promise<Probe> {
  const { stdout } = await promisify(execFile)(ffprobePath(), ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height", "-of", "json", file]);

  return JSON.parse(stdout) as Probe;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

describe("Export MP4", () => {
  describe("exports the open video", () => {
    let opened: Awaited<ReturnType<typeof openVideo>>;
    let target = "";
    let statuses: ExportStatus[] = [];
    const running: number[] = [];
    const onExportsChange = (count: number) => running.push(count);

    beforeAll(async () => {
      opened = await openVideo({ onExportsChange });
      target = join(workDir, "Exported video.mp4");
      statuses = await collect(await opened.client.export.mp4({ previewId: opened.previewId, path: target, video: opened.video }));
    }, EXPORT_TIMEOUT_MS);

    it("as an MP4 at the chosen path, as long as the video, with the Voiceover as its audio track", async () => {
      const { format, streams } = await probe(target);

      expect(statuses.at(-1)).toEqual({ state: "done", path: target });
      expect(Number(format.duration)).toBeCloseTo(8.2, 1);
      expect(streams).toEqual([
        { codec_type: "video", codec_name: "h264", width: 1920, height: 1080 },
        { codec_type: "audio", codec_name: "aac" },
      ]);
    });

    it("reporting its progress through each stage as it goes", () => {
      const rendering = statuses.flatMap((status) => (status.state === "rendering" ? [status] : []));
      const progress = rendering.map((status) => status.progress);
      const stages = [...new Set(rendering.map(({ stage }) => stage))];
      const order = ["preparing", "capturing", "encoding", "finishing"];

      // Whether encoding shows as a stage of its own depends on how many browsers the computer runs at once.
      expect(stages.slice(0, 2)).toEqual(["preparing", "capturing"]);
      expect(stages).toEqual([...stages].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
      expect(progress.length).toBeGreaterThan(10);
      expect(progress).toEqual([...progress].sort((a, b) => a - b));
      expect(progress.every((value) => value >= 0 && value <= 1)).toBe(true);
    });

    it("and remembers where it was saved, for that video only", async () => {
      const { client, video } = opened;

      expect(await client.export.lastPath(video)).toEqual({ path: target });
      expect(await client.export.lastPath({ ...video, format: "vertical" })).toEqual({});
      expect(await client.export.lastPath(UNOPENED)).toEqual({});
    });

    it("in the video's folder inside the Project, so the Project keeps it", async () => {
      const saved: unknown = JSON.parse(await readFile(join(opened.projectDir, "horizontal", "video.json"), "utf8"));

      expect(saved).toEqual({ lastExportPath: target });
    });

    it("telling main while it runs, so an app update waits for it", () => {
      expect(running).toEqual([1, 0]);
    });
  });

  it(
    "stops when the creator cancels, leaving no file behind and the last path as it was",
    async () => {
      const { client, cacheDir, previewId, video } = await openVideo();
      const target = join(workDir, "Cancelled.mp4");
      const controller = new AbortController();
      const statuses: ExportStatus[] = [];

      const exporting = (async () => {
        for await (const status of await client.export.mp4({ previewId, path: target, video }, { signal: controller.signal })) {
          statuses.push(status);

          if (status.state === "rendering" && status.stage === "capturing") {
            controller.abort();
          }
        }
      })();

      await exporting.catch(() => undefined);

      expect(statuses.at(-1)).toMatchObject({ state: "rendering", stage: "capturing" });
      await vi.waitFor(async () => expect(await readdir(join(cacheDir, "export")).catch(() => [])).toEqual([]), { timeout: 30_000, interval: 250 });
      expect(await exists(target)).toBe(false);
      expect(await client.export.lastPath(video)).toEqual({});
    },
    EXPORT_TIMEOUT_MS,
  );

  it("starts no export while an app update holds them, and starts again once released", async () => {
    const appDataDir = await mkdtemp(join(workDir, "app-data-"));
    const { router, exports } = createCore({ appVersion: "1.2.3", appDataDir, cacheDir: join(appDataDir, "cache") });
    const client = createRouterClient(router);
    const { id: previewId } = await client.preview.open(await source());
    const target = join(workDir, "missing folder", "Held.mp4");

    expect(exports.hold()).toBe(0);
    expect(await collect(await client.export.mp4({ previewId, path: target, video: UNOPENED }))).toEqual([{ state: "failed", error: { code: "UPDATING" } }]);

    exports.release();
    // Past the hold: this one fails on its missing folder instead.
    expect(await collect(await client.export.mp4({ previewId, path: target, video: UNOPENED }))).toMatchObject([{ state: "failed", error: { code: "SAVE_FAILED" } }]);
  });

  it("refuses a video that isn't open", async () => {
    const statuses = async () => collect(await connect().export.mp4({ previewId: "0123456789abcdef", path: join(workDir, "Nope.mp4"), video: UNOPENED }));

    await expect(statuses()).rejects.toMatchObject({ code: "PREVIEW_NOT_FOUND", data: { id: "0123456789abcdef" } });
  });

  describe("fails, with nothing saved", () => {
    it("into a folder that isn't there", async () => {
      const { client, previewId } = await openPreview();
      const target = join(workDir, "missing folder", "Video.mp4");

      const statuses = await collect(await client.export.mp4({ previewId, path: target, video: UNOPENED }));

      expect(statuses).toEqual([{ state: "failed", error: { code: "SAVE_FAILED", path: target, message: expect.any(String) } }]);
    });

    it("without the pinned FFmpeg", async () => {
      const missing = join(workDir, "no-ffmpeg", "ffmpeg.exe");
      const { client, previewId } = await openPreview({ ffmpegPath: missing });
      const target = join(workDir, "No FFmpeg.mp4");

      const statuses = await collect(await client.export.mp4({ previewId, path: target, video: UNOPENED }));

      expect(statuses).toEqual([{ state: "failed", error: { code: "FFMPEG_MISSING", path: missing } }]);
      expect(await exists(target)).toBe(false);
    });

    it("without the pinned browser", async () => {
      const missing = join(workDir, "no-chrome", "chrome-headless-shell.exe");
      const { client, previewId } = await openPreview({ chromePath: missing });

      const statuses = await collect(await client.export.mp4({ previewId, path: join(workDir, "No Chrome.mp4"), video: UNOPENED }));

      expect(statuses).toEqual([{ state: "failed", error: { code: "CHROME_MISSING", path: missing } }]);
    });
  });
});
