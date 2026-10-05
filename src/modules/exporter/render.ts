import type { RenderJob } from "@hyperframes/producer";
import type { ExportStage, ExportStatus } from "../../contract";

/** An export's status while it renders: always with its stage and progress. */
type Rendering = ExportStatus & { state: "rendering"; stage: ExportStage; progress: number };

export type RenderOutcome = { code: "DONE" } | { code: "CANCELLED" } | { code: "RENDER_FAILED"; message: string };

type RenderOptions = {
  /** The assembled page's folder. */
  pageDir: string;
  /** Where the MP4 is written. */
  output: string;
  chromePath: string;
  ffmpegPath: string;
  ffprobePath: string;
  signal: AbortSignal;
};

/** The frame rate every export renders at. */
const FPS = 30;

const STAGES: Partial<Record<RenderJob["status"], Rendering["stage"]>> = {
  queued: "preparing",
  preprocessing: "preparing",
  rendering: "capturing",
  encoding: "encoding",
  assembling: "finishing",
};

/** Progress moves on in steps of at least this much, so the stream stays light. */
const PROGRESS_STEP = 0.01;

/**
 * Renders an assembled page to an MP4 with `@hyperframes/producer`, the engine behind the player,
 * driving the pinned chrome-headless-shell and FFmpeg. Streams the render's stage and progress,
 * and returns how it ended. Aborting `signal` cancels the render.
 */
export async function* renderMp4({ pageDir, output, chromePath, ffmpegPath, ffprobePath, signal }: RenderOptions): AsyncGenerator<Rendering, RenderOutcome> {
  // The producer is large: it loads with the first export, not with the core.
  const { createConsoleLogger, createRenderJob, executeRenderJob, resolveConfig } = await import("@hyperframes/producer");

  // The producer finds FFmpeg and FFprobe through these, and only these, variables.
  process.env["HYPERFRAMES_FFMPEG_PATH"] = ffmpegPath;
  process.env["HYPERFRAMES_FFPROBE_PATH"] = ffprobePath;
  process.env["HYPERFRAMES_NO_TELEMETRY"] = "1";
  process.env["DO_NOT_TRACK"] = "1";

  const job = createRenderJob({ fps: FPS, quality: "high", producerConfig: resolveConfig({ chromePath }), logger: createConsoleLogger("error") });
  const controller = new AbortController();
  const abort = () => controller.abort();
  const updates: Rendering[] = [];
  let last: Rendering | undefined;
  let isSettled = false;
  let wake = () => {};

  signal.addEventListener("abort", abort, { once: true });

  if (signal.aborted) {
    abort();
  }

  const onProgress = (update: RenderJob) => {
    const stage = STAGES[update.status];
    const progress = Math.min(1, Math.max(last?.progress ?? 0, update.progress / 100));

    if (!stage || (stage === last?.stage && progress - last.progress < PROGRESS_STEP)) {
      return;
    }

    last = { state: "rendering", stage, progress };
    updates.push(last);
    wake();
  };

  const settled = executeRenderJob(job, pageDir, output, onProgress, controller.signal).then(
    () => undefined,
    (error: unknown) => error,
  );
  void settled.then(() => {
    isSettled = true;
    wake();
  });

  try {
    while (!isSettled || updates.length > 0) {
      const update = updates.shift();

      if (update) {
        yield update;
        continue;
      }

      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }

    const error = await settled;

    if (controller.signal.aborted) {
      return { code: "CANCELLED" };
    }

    if (error !== undefined) {
      return { code: "RENDER_FAILED", message: error instanceof Error ? error.message : String(error) };
    }

    return { code: "DONE" };
  } finally {
    // Reached early when the caller stops listening: the render stops before its files go.
    signal.removeEventListener("abort", abort);
    abort();
    await settled;
  }
}
