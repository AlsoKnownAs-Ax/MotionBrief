import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import type { StoryboardIssue, VideoSource } from "../../contract";
import { assemble } from "../assembler";
import type { Cache, CacheError } from "../cache";
import { openFramePage, type FramePageError } from "../checker";
import { FRAME_CONTRACT_VERSION } from "../frame";
import { validateStoryboard } from "../storyboard";

export type StillsOptions = {
  /** Stills are kept in the app cache, keyed by what they show. */
  cache: Cache;
  /** The pinned chrome-headless-shell they are drawn in. */
  chromePath: string;
};

export type StillError = { code: "INVALID_STORYBOARD"; issues: StoryboardIssue[] } | { code: "CHROME_MISSING"; path: string } | FramePageError | CacheError;

type Result<T, E> = { data: T; error: null } | { data: null; error: E };

export type Stills = ReturnType<typeof createStills>;

/** Stills are this many pixels wide by default: sharp in a picker card or the Preset editor on a high-density screen. */
const STILL_WIDTH = 640;

/**
 * Single frames of videos, such as a Style Preset's sample or a unit for visual review: assembled in a
 * scratch folder, drawn in the pinned browser, and cached as JPEG files keyed by a hash of what they
 * show. One browser at a time draws them, so a picker full of Presets never launches a browser per card.
 */
export function createStills({ cache, chromePath }: StillsOptions) {
  const drawing = new Map<string, Promise<Result<Uint8Array[], StillError>>>();
  let queue: Promise<unknown> = Promise.resolve();

  /** The frame at `time` seconds into the video, as a JPEG data URL. */
  async function still(source: VideoSource, time: number): Promise<Result<string, StillError>> {
    const { data: jpegs, error } = await frames(source, [time]);

    if (error) {
      return { data: null, error };
    }

    return { data: dataUrl(jpegs[0] ?? new Uint8Array()), error: null };
  }

  /** The frames at each of `times` seconds into the video, `width` pixels wide, as JPEG bytes in the same order. */
  async function frames(source: VideoSource, times: number[], width = STILL_WIDTH): Promise<Result<Uint8Array[], StillError>> {
    const keys = times.map((time) => `stills/${stillId(source, time, width)}.jpg`);
    const cached = await Promise.all(keys.map(readCached));

    if (cached.every((jpeg) => jpeg !== undefined)) {
      return { data: cached, error: null };
    }

    const id = keys.join(" ");
    const pending = drawing.get(id);

    if (pending) {
      return pending;
    }

    const done = queue.then(() => draw(source, times, width, keys));
    queue = done.catch(() => undefined);
    drawing.set(id, done);

    try {
      return await done;
    } finally {
      drawing.delete(id);
    }
  }

  async function readCached(key: string): Promise<Uint8Array | undefined> {
    const path = await cache.get(key);

    return path ? readFile(path).catch(() => undefined) : undefined;
  }

  async function draw(source: VideoSource, times: number[], stillWidth: number, keys: string[]): Promise<Result<Uint8Array[], StillError>> {
    const { data: storyboard, error } = validateStoryboard(source.storyboard, source.transcript, source.rules);

    if (error) {
      return { data: null, error: { code: "INVALID_STORYBOARD", issues: error.issues } };
    }

    if (!(await exists(chromePath))) {
      return { data: null, error: { code: "CHROME_MISSING", path: chromePath } };
    }

    const { data: dir, error: scratchError } = await cache.scratch();

    if (scratchError) {
      return { data: null, error: scratchError };
    }

    try {
      await mkdir(dir, { recursive: true });
      const { width, height } = await assemble({ dir, storyboard, transcript: source.transcript, preset: source.preset, code: source.code });
      const { data: frame, error: frameError } = await openFramePage({ dir, chromePath, width, height, scale: stillWidth / width });

      if (frameError) {
        return { data: null, error: frameError };
      }

      try {
        const jpegs: Uint8Array[] = [];

        for (const [index, time] of times.entries()) {
          await frame.seek(time);
          const jpeg = await frame.screenshot();
          // A still that can't be cached is still shown; it is only drawn again next time.
          await cache.put(keys[index] ?? "", (path) => writeFile(path, jpeg).then(() => ({ data: null, error: null })));
          jpegs.push(jpeg);
        }

        return { data: jpegs, error: null };
      } finally {
        await frame.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  return { still, frames };
}

/** Same video, same moment, same size: the id names all three. */
function stillId(source: VideoSource, time: number, width: number): string {
  const key = JSON.stringify({ frame: FRAME_CONTRACT_VERSION, width, time, source });

  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

function dataUrl(jpeg: Uint8Array): string {
  return `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
