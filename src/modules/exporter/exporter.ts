import { randomUUID } from "node:crypto";
import { access, copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExportError, ExportStatus, VideoRef, VideoSource } from "../../contract";
import { assemble } from "../assembler";
import { validateStoryboard } from "../storyboard";
import type { ExportLocations } from "./locations";
import { renderMp4 } from "./render";

export type ExporterOptions = {
  /** Where renders are made before they are saved; one subfolder per export, deleted when it ends. */
  workDir: string;
  /** The pinned chrome-headless-shell. */
  chromePath: string;
  /** The pinned FFmpeg and FFprobe. */
  ffmpegPath: string;
  ffprobePath: string;
  locations: ExportLocations;
  /** Called with how many exports are running whenever one starts or ends. */
  onRunningChange?: (running: number) => void;
};

export type ExportRequest = {
  /** What the video is assembled from: the same source as the preview the creator watched. */
  source: VideoSource;
  /** Where the creator chose to save the MP4. */
  path: string;
  /** The video whose last export path is remembered. */
  video: VideoRef;
  signal?: AbortSignal;
};

export type Exporter = ReturnType<typeof createExporter>;

/**
 * Exports videos as MP4s: assembles the video as the preview does, renders it with the engine the
 * player uses, and only then moves it to where the creator chose, so a cancelled or failed export
 * leaves nothing there and never touches an earlier file.
 */
export function createExporter({ workDir, chromePath, ffmpegPath, ffprobePath, locations, onRunningChange }: ExporterOptions) {
  const running = new Set<string>();

  async function* mp4({ source, path, video, signal = new AbortController().signal }: ExportRequest): AsyncGenerator<ExportStatus> {
    const problem = await preflight(path);

    if (problem) {
      yield { state: "failed", error: problem };
      return;
    }

    const id = randomUUID();
    const dir = join(workDir, id);
    running.add(id);
    onRunningChange?.(running.size);

    try {
      yield { state: "rendering", stage: "preparing", progress: 0 };
      await clearAbandoned();
      const pageDir = join(dir, "page");
      const output = join(dir, "video.mp4");
      await mkdir(pageDir, { recursive: true });

      const { data: storyboard, error } = validateStoryboard(source.storyboard, source.transcript, source.rules);

      if (error) {
        yield { state: "failed", error: { code: "RENDER_FAILED", message: `The Storyboard isn't valid: ${error.issues.map(({ message }) => message).join("; ")}` } };
        return;
      }

      await assemble({ dir: pageDir, storyboard, transcript: source.transcript, preset: source.preset, code: source.code, voiceover: source.voiceover });

      const outcome = yield* renderMp4({ pageDir, output, chromePath, ffmpegPath, ffprobePath, signal });

      if (outcome.code === "CANCELLED") {
        return;
      }

      if (outcome.code === "RENDER_FAILED") {
        yield { state: "failed", error: outcome };
        return;
      }

      const saveError = await save(output, path);

      if (saveError) {
        yield { state: "failed", error: saveError };
        return;
      }

      await locations.remember(video, path).catch((rememberError: unknown) => console.error("[export] the export path wasn't remembered", rememberError));

      yield { state: "done", path };
    } finally {
      running.delete(id);
      onRunningChange?.(running.size);
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Fails before rendering when a pinned binary or the chosen folder isn't there. */
  async function preflight(path: string): Promise<ExportError | undefined> {
    if (!(await exists(chromePath))) {
      return { code: "CHROME_MISSING", path: chromePath };
    }

    for (const binary of [ffmpegPath, ffprobePath]) {
      if (!(await exists(binary))) {
        return { code: "FFMPEG_MISSING", path: binary };
      }
    }

    const folder = dirname(path);
    const info = await stat(folder).catch(() => undefined);

    if (!info?.isDirectory()) {
      return { code: "SAVE_FAILED", path, message: `The folder ${folder} isn't there.` };
    }

    return undefined;
  }

  /** Renders left by a core that stopped mid-export. */
  async function clearAbandoned() {
    const entries = await readdir(workDir).catch(() => []);

    await Promise.all(entries.filter((name) => !running.has(name)).map((name) => rm(join(workDir, name), { recursive: true, force: true })));
  }

  return {
    mp4,
    lastPath: (video: VideoRef) => locations.last(video),
  };
}

/**
 * Moves the finished MP4 into place. Across drives it is copied beside the target first, so the
 * target is only ever replaced by a whole file.
 */
async function save(output: string, path: string): Promise<ExportError | undefined> {
  try {
    await rename(output, path);
    return undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
      return { code: "SAVE_FAILED", path, message: (error as Error).message };
    }
  }

  const part = `${path}.part`;

  try {
    await copyFile(output, part);
    await rename(part, path);
    return undefined;
  } catch (error) {
    await rm(part, { force: true });
    return { code: "SAVE_FAILED", path, message: (error as Error).message };
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
