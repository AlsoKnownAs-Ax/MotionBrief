import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Preview, SceneThumbnail, StoryboardIssue, VideoSource, VideoTimeline } from "../../contract";
import { assemble, planUnits, type AssembledPage } from "../assembler";
import { openFramePage, type FramePage, type FramePageError } from "../checker";
import { FRAME_CONTRACT_VERSION } from "../frame";
import { validateStoryboard } from "../storyboard";
import { startPreviewServer, type PreviewServer } from "./server";
import { timelineOf } from "./timeline";

export type PreviewsOptions = {
  /** The folder assembled pages are kept in, one subfolder per page id. */
  rootDir: string;
  /** The pinned chrome-headless-shell, for thumbnails. */
  chromePath: string;
};

export type PreviewError =
  | { code: "INVALID_STORYBOARD"; issues: StoryboardIssue[] }
  | { code: "UNKNOWN_UNIT"; unit: string; units: string[] }
  | { code: "VOICEOVER_MISSING"; path: string };

const PREVIEW_ERRORS = {
  VOICEOVER_MISSING: (error) => `The Voiceover isn't at ${error.path} any more.`,
  INVALID_STORYBOARD: (error) => error.issues.map((issue) => issue.message).join(" "),
  UNKNOWN_UNIT: (error) => `The Storyboard has no unit ${error.unit}.`,
} satisfies { [Code in PreviewError["code"]]: (error: Extract<PreviewError, { code: Code }>) => string };

/** One sentence on why a video couldn't be shown, as a run's status says it. */
export function previewErrorMessage(error: PreviewError): string {
  // The table is keyed by code, so each entry receives the error of its own code.
  return (PREVIEW_ERRORS[error.code] as (error: PreviewError) => string)(error);
}

/** The file's stats; none for a page without a Voiceover, or a Voiceover that isn't there. */
async function statOf(path: string | undefined) {
  if (!path) {
    return undefined;
  }

  return stat(path).catch(() => undefined);
}

export type ThumbnailsError = { code: "PREVIEW_NOT_FOUND"; id: string } | { code: "CHROME_MISSING"; path: string } | FramePageError;

type Result<T, E> = { data: T; error: null } | { data: null; error: E };

export type Previews = ReturnType<typeof createPreviews>;

/** Assembled pages kept besides the open ones; older ones are deleted. */
const KEPT_PAGES = 8;

/** Thumbnails are this many pixels on their short side. */
const THUMBNAIL_SIZE = 180;

/** A thumbnail shows its Scene just before it ends, with every element in. */
const THUMBNAIL_BEFORE_END = 0.15;

type OpenPage = { dir: string; page: AssembledPage; timeline: VideoTimeline; source: VideoSource };

/**
 * Previews of videos: each is assembled into its own folder, named by a hash of its source so the
 * same source always builds the same page, and served on this computer for the player.
 */
export function createPreviews({ rootDir, chromePath }: PreviewsOptions) {
  const pages = new Map<string, OpenPage>();
  const building = new Map<string, Promise<OpenPage>>();
  let server: Promise<PreviewServer> | undefined;

  async function open(source: VideoSource): Promise<Result<Preview, PreviewError>> {
    const { data: storyboard, error } = validateStoryboard(source.storyboard, source.transcript, source.rules);

    if (error) {
      return { data: null, error: { code: "INVALID_STORYBOARD", issues: error.issues } };
    }

    const units = planUnits(storyboard, source.transcript).map(({ id }) => id);
    const unknown = Object.keys(source.code).find((unit) => !units.includes(unit));

    if (unknown) {
      return { data: null, error: { code: "UNKNOWN_UNIT", unit: unknown, units } };
    }

    const voiceover = await statOf(source.voiceover);

    if (source.voiceover && !voiceover?.isFile()) {
      return { data: null, error: { code: "VOICEOVER_MISSING", path: source.voiceover } };
    }

    const id = pageId({ ...source, storyboard }, voiceover && { size: voiceover.size, modified: voiceover.mtimeMs });
    const page = await build(id, async (dir) => {
      const assembled = await assemble({
        dir,
        storyboard,
        transcript: source.transcript,
        preset: source.preset,
        code: source.code,
        voiceover: source.voiceover,
        captions: source.captions ?? source.rules.captions,
      });

      return { dir, page: assembled, timeline: timelineOf(storyboard, source.transcript, assembled, source.code), source };
    });
    const { origin } = await (server ??= startPreviewServer(rootDir));
    // Units still being generated and review notes don't change the page, only how the timeline shows them.
    const timeline = timelineOf(storyboard, source.transcript, page.page, source.code, source.pending, source.notes);

    return { data: { id, url: `${origin}/${id}/index.html`, timeline }, error: null };
  }

  /**
   * One build per page: a page already built is served as it is, so a player showing it never sees it
   * rewritten, and a page asked for again while it builds waits for that build.
   */
  async function build(id: string, write: (dir: string) => Promise<OpenPage>): Promise<OpenPage> {
    const built = pages.get(id);
    const pending = building.get(id);

    if (built) {
      return built;
    }

    if (pending) {
      return pending;
    }

    const dir = join(rootDir, id);
    const done = (async () => {
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });

      return write(dir);
    })();

    building.set(id, done);

    try {
      const page = await done;
      pages.set(id, page);
      await prune();

      return page;
    } finally {
      building.delete(id);
    }
  }

  /** Keeps the newest pages; a Voiceover in an older one is a link or copy, so deleting it is safe. */
  async function prune() {
    const entries = await readdir(rootDir, { withFileTypes: true });
    const folders = await Promise.all(
      entries.filter((entry) => entry.isDirectory()).map(async ({ name }) => ({ name, modified: (await stat(join(rootDir, name))).mtimeMs })),
    );
    const old = folders.sort((a, b) => b.modified - a.modified).slice(KEPT_PAGES);

    await Promise.all(
      old.map(async ({ name }) => {
        pages.delete(name);
        await rm(join(rootDir, name), { recursive: true, force: true });
      }),
    );
  }

  /** A still of each Scene of an open page, from the cache in its folder or rendered in the pinned browser. */
  async function thumbnails(id: string): Promise<Result<AsyncGenerator<SceneThumbnail>, ThumbnailsError>> {
    const open = pages.get(id);

    if (!open) {
      return { data: null, error: { code: "PREVIEW_NOT_FOUND", id } };
    }

    const cached = await Promise.all(open.timeline.scenes.map(({ id: sceneId }) => readThumbnail(open.dir, sceneId)));

    if (cached.every((image) => image !== undefined)) {
      return { data: fromCache(open, cached), error: null };
    }

    if (!(await exists(chromePath))) {
      return { data: null, error: { code: "CHROME_MISSING", path: chromePath } };
    }

    const { width, height } = open.page;
    const { data: frame, error } = await openFramePage({ dir: open.dir, chromePath, width, height, scale: THUMBNAIL_SIZE / Math.min(width, height) });

    if (error) {
      return { data: null, error };
    }

    return { data: rendered(open, frame), error: null };
  }

  async function* fromCache(open: OpenPage, images: (string | undefined)[]): AsyncGenerator<SceneThumbnail> {
    for (const [index, scene] of open.timeline.scenes.entries()) {
      yield { sceneId: scene.id, image: images[index] ?? "" };
    }
  }

  async function* rendered(open: OpenPage, frame: FramePage): AsyncGenerator<SceneThumbnail> {
    try {
      for (const scene of open.timeline.scenes) {
        await frame.seek(Math.max(scene.start, scene.end - THUMBNAIL_BEFORE_END));
        const jpeg = await frame.screenshot();
        await writeFile(thumbnailPath(open.dir, scene.id), jpeg).catch(() => undefined);

        yield { sceneId: scene.id, image: dataUrl(jpeg) };
      }
    } finally {
      await frame.close();
    }
  }

  /** What an open page was assembled from, so an export builds the same video; `undefined` if it isn't open. */
  function source(id: string): VideoSource | undefined {
    return pages.get(id)?.source;
  }

  async function close() {
    await (await server)?.close();
  }

  return { open, thumbnails, source, close };
}

/** Same source, same id: the Storyboard, Transcript, Style Preset, Captions, code and Voiceover, and the frame they are built in. */
function pageId(source: VideoSource, voiceover: { size: number; modified: number } | undefined): string {
  const code = Object.fromEntries(Object.entries(source.code).sort(([a], [b]) => a.localeCompare(b)));
  const key = JSON.stringify({
    frame: FRAME_CONTRACT_VERSION,
    storyboard: source.storyboard,
    transcript: source.transcript,
    preset: source.preset,
    captions: source.captions ?? source.rules.captions,
    code,
    voiceover: source.voiceover && { path: source.voiceover, ...voiceover },
  });

  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function thumbnailPath(dir: string, sceneId: string): string {
  return join(dir, `thumbnail-${sceneId}.jpg`);
}

async function readThumbnail(dir: string, sceneId: string): Promise<string | undefined> {
  const jpeg = await readFile(thumbnailPath(dir, sceneId)).catch(() => undefined);

  return jpeg && dataUrl(jpeg);
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
