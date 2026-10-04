import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ExportStatus, UnitCode, VideoRef, VideoSource } from "../contract";
import storyboard from "./fixtures/checker/storyboard.json";
import transcript from "./fixtures/checker/transcript.json";
import { ffprobePath } from "./native";
import { BLUEPRINT, connect, RULES } from "./test-support/checker";
import { silentWav } from "./test-support/voiceover";

/** An export renders every frame in the pinned browser and encodes with the pinned FFmpeg. */
const EXPORT_TIMEOUT_MS = 180_000;

const VIDEO: VideoRef = { projectId: "0f8c2a51-export-test", format: "horizontal" };

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

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "motionbrief-export-"));
  voiceover = join(workDir, "Voiceover.wav");
  await writeFile(voiceover, silentWav());
});

afterAll(() => rm(workDir, { recursive: true, force: true }));

async function source(): Promise<VideoSource> {
  return { storyboard, transcript, rules: RULES, preset: BLUEPRINT, code: await goodCode(), voiceover };
}

/** A core with its own app data folder, and the video open in its player. */
async function openVideo(options: Parameters<typeof connect>[0] = {}) {
  const appDataDir = await mkdtemp(join(workDir, "app-data-"));
  const client = connect({ appDataDir, ...options });
  const preview = await client.preview.open(await source());

  return { client, appDataDir, previewId: preview.id };
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
    let client: Awaited<ReturnType<typeof openVideo>>["client"];
    let target = "";
    let statuses: ExportStatus[] = [];

    beforeAll(async () => {
      const opened = await openVideo();
      client = opened.client;
      target = join(workDir, "Exported video.mp4");
      statuses = await collect(await client.export.mp4({ previewId: opened.previewId, path: target, video: VIDEO }));
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
      expect(await client.export.lastPath(VIDEO)).toEqual({ path: target });
      expect(await client.export.lastPath({ ...VIDEO, format: "vertical" })).toEqual({});
      expect(await client.export.lastPath({ ...VIDEO, projectId: "another-project" })).toEqual({});
    });
  });

  it(
    "stops when the creator cancels, leaving no file behind and the last path as it was",
    async () => {
      const { client, appDataDir, previewId } = await openVideo();
      const target = join(workDir, "Cancelled.mp4");
      const controller = new AbortController();
      const statuses: ExportStatus[] = [];

      const exporting = (async () => {
        for await (const status of await client.export.mp4({ previewId, path: target, video: VIDEO }, { signal: controller.signal })) {
          statuses.push(status);

          if (status.state === "rendering" && status.stage === "capturing") {
            controller.abort();
          }
        }
      })();

      await exporting.catch(() => undefined);

      expect(statuses.at(-1)).toMatchObject({ state: "rendering", stage: "capturing" });
      await vi.waitFor(async () => expect(await readdir(join(appDataDir, "cache", "export")).catch(() => [])).toEqual([]), { timeout: 30_000, interval: 250 });
      expect(await exists(target)).toBe(false);
      expect(await client.export.lastPath(VIDEO)).toEqual({});
    },
    EXPORT_TIMEOUT_MS,
  );

  it("refuses a video that isn't open", async () => {
    const statuses = async () => collect(await connect().export.mp4({ previewId: "0123456789abcdef", path: join(workDir, "Nope.mp4"), video: VIDEO }));

    await expect(statuses()).rejects.toMatchObject({ code: "PREVIEW_NOT_FOUND", data: { id: "0123456789abcdef" } });
  });

  describe("fails, with nothing saved", () => {
    it("into a folder that isn't there", async () => {
      const { client, previewId } = await openVideo();
      const target = join(workDir, "missing folder", "Video.mp4");

      const statuses = await collect(await client.export.mp4({ previewId, path: target, video: VIDEO }));

      expect(statuses).toEqual([{ state: "failed", error: { code: "SAVE_FAILED", path: target, message: expect.any(String) } }]);
    });

    it("without the pinned FFmpeg", async () => {
      const missing = join(workDir, "no-ffmpeg", "ffmpeg.exe");
      const { client, previewId } = await openVideo({ ffmpegPath: missing });
      const target = join(workDir, "No FFmpeg.mp4");

      const statuses = await collect(await client.export.mp4({ previewId, path: target, video: VIDEO }));

      expect(statuses).toEqual([{ state: "failed", error: { code: "FFMPEG_MISSING", path: missing } }]);
      expect(await exists(target)).toBe(false);
    });

    it("without the pinned browser", async () => {
      const missing = join(workDir, "no-chrome", "chrome-headless-shell.exe");
      const { client, previewId } = await openVideo({ chromePath: missing });

      const statuses = await collect(await client.export.mp4({ previewId, path: join(workDir, "No Chrome.mp4"), video: VIDEO }));

      expect(statuses).toEqual([{ state: "failed", error: { code: "CHROME_MISSING", path: missing } }]);
    });
  });
});
