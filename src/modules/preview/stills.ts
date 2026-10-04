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

/** Stills are this many pixels wide: sharp in a picker card or the Preset editor on a high-density screen. */
const STILL_WIDTH = 640;

/**
 * Single frames of small videos, such as a Style Preset's sample: assembled in a scratch folder, drawn in the
 * pinned browser, and cached as JPEG files. One browser at a time draws them, so a picker full of Presets never
 * launches a browser per card.
 */
export function createStills({ cache, chromePath }: StillsOptions) {
  const drawing = new Map<string, Promise<Result<string, StillError>>>();
  let queue: Promise<unknown> = Promise.resolve();

  /** The frame at `time` seconds into the video, as a JPEG data URL. */
  async function still(source: VideoSource, time: number): Promise<Result<string, StillError>> {
    const key = `stills/${stillId(source, time)}.jpg`;
    const cached = await cache.get(key);
    const jpeg = cached && (await readFile(cached).catch(() => undefined));

    if (jpeg) {
      return { data: dataUrl(jpeg), error: null };
    }

    const pending = drawing.get(key);

    if (pending) {
      return pending;
    }

    const done = queue.then(() => draw(source, time, key));
    queue = done.catch(() => undefined);
    drawing.set(key, done);

    try {
      return await done;
    } finally {
      drawing.delete(key);
    }
  }

  async function draw(source: VideoSource, time: number, key: string): Promise<Result<string, StillError>> {
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
      const { data: frame, error: frameError } = await openFramePage({ dir, chromePath, width, height, scale: STILL_WIDTH / width });

      if (frameError) {
        return { data: null, error: frameError };
      }

      try {
        await frame.seek(time);
        const jpeg = await frame.screenshot();
        // A still that can't be cached is still shown; it is only drawn again next time.
        await cache.put(key, (path) => writeFile(path, jpeg).then(() => ({ data: null, error: null })));

        return { data: dataUrl(jpeg), error: null };
      } finally {
        await frame.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  return { still };
}

/** Same video, same moment, same frame: the id names all three. */
function stillId(source: VideoSource, time: number): string {
  const key = JSON.stringify({ frame: FRAME_CONTRACT_VERSION, width: STILL_WIDTH, time, source });

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
