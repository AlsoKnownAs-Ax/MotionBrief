import { isDefinedError, safe } from "@orpc/client";
import { create } from "zustand";
import { useToast } from "@renderer/components/toast";
import { core } from "@renderer/core/connection";
import { useNavigation } from "@renderer/navigation";
import type { FrameUpdate, Project, VideoRef } from "../../../contract";
import { useGeneration } from "./generation";

const openVideo = (video: VideoRef) => safe(core.video.open(video));
const retryVideo = (input: VideoRef & { units: string[] }) => safe(core.video.retry(input));

type OpenError = NonNullable<Awaited<ReturnType<typeof openVideo>>["error"]>;
type RetryError = NonNullable<Awaited<ReturnType<typeof retryVideo>>["error"]>;

type FrameUpdateNotice = {
  /** The video the re-check ran on, with the units that became flagged fallbacks. */
  notice?: { video: VideoRef; units: string[] };
  /** Why the last Retry didn't start. */
  retryError?: string;
  retry: (units: string[]) => Promise<void>;
  dismiss: () => void;
};

/** The notice strip announcing a re-check after an app update changed the frame's major version: one per window. */
export const useFrameUpdate = create<FrameUpdateNotice>((set, get) => ({
  retry: async (units) => {
    const { notice } = get();

    if (!notice) {
      return;
    }

    set({ retryError: undefined });
    const { error } = await retryVideo({ ...notice.video, units });

    if (error) {
      set({ retryError: retryErrorMessage(error) });
      return;
    }

    set({ notice: undefined });
  },
  dismiss: () => set({ notice: undefined, retryError: undefined }),
}));

/**
 * Opens the Project's saved video in the editor; after an app update that changed the frame's major version, opening
 * first re-checks its units. Answers whether the Project has no video yet, so New Project can show it instead.
 */
export async function openStoredVideo(project: Project): Promise<"opened" | "no-video" | "failed"> {
  const video = { projectId: project.id, format: project.format };
  const { data: opened, error } = await openVideo(video);

  if (isDefinedError(error) && (error.code === "NO_VIDEO" || error.code === "TRANSCRIPT_NOT_READY")) {
    return "no-video";
  }

  if (error) {
    useToast.getState().show({ text: openErrorMessage(error) });
    void safe(core.project.close({ projectId: project.id }));

    return "failed";
  }

  useGeneration.getState().follow(project, video, opened.preview);
  useFrameUpdate.setState({ notice: noticeOf(video, opened.frameUpdate), retryError: undefined });
  useNavigation.getState().openEditor();

  return "opened";
}

function noticeOf(video: VideoRef, frameUpdate: FrameUpdate | undefined) {
  if (!frameUpdate) {
    return undefined;
  }

  return { video, units: frameUpdate.units };
}

type ErrorData = { path?: string; message?: string };

const DAMAGED = () => "The video's files in this Project are damaged, so it can't play.";
const CLOSED = () => "This Project was closed. Go back to Home and start again.";

/** One sentence per error code `video.open` answers with, besides having no video yet. */
const OPEN_MESSAGES = {
  UNKNOWN_PROJECT: CLOSED,
  TRANSCRIPT_NOT_READY: CLOSED,
  NO_VIDEO: CLOSED,
  VOICEOVER_MISSING: () => "The Project's Voiceover file is missing, so its video can't play. Put the Voiceover back in the Project folder.",
  INVALID_VERSION: DAMAGED,
  INVALID_STORYBOARD: DAMAGED,
  UNKNOWN_UNIT: DAMAGED,
  FILE_FAILED: ({ path, message }: ErrorData) => `Couldn't read or save ${path || "the Project folder"}: ${message ?? "the file system refused"}.`,
} satisfies Record<Extract<OpenError, { defined: true }>["code"], (data: ErrorData) => string>;

/** One sentence per error code `video.retry` answers with. */
const RETRY_MESSAGES = {
  ...OPEN_MESSAGES,
  GENERATING: () => "Scenes of this video are already being written. Retry once they're done.",
  NOT_FLAGGED: () => "Those Scenes aren't flagged any more.",
} satisfies Record<Extract<RetryError, { defined: true }>["code"], (data: ErrorData) => string>;

const UNKNOWN_ERROR = "Something went wrong talking to the MotionBrief core. Try again.";

function openErrorMessage(error: OpenError) {
  if (!isDefinedError(error)) {
    return UNKNOWN_ERROR;
  }

  return OPEN_MESSAGES[error.code](error.data as ErrorData);
}

function retryErrorMessage(error: RetryError) {
  if (!isDefinedError(error)) {
    return UNKNOWN_ERROR;
  }

  return RETRY_MESSAGES[error.code](error.data as ErrorData);
}
