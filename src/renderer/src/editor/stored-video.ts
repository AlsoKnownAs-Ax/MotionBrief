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
  return frameUpdate ? { video, units: frameUpdate.units } : undefined;
}

function openErrorMessage(error: OpenError) {
  if (!isDefinedError(error)) {
    return "Something went wrong talking to the MotionBrief core. Try again.";
  }

  switch (error.code) {
    case "VOICEOVER_MISSING":
      return "The Project's Voiceover file is missing, so its video can't play. Put the Voiceover back in the Project folder.";
    case "INVALID_VERSION":
    case "INVALID_STORYBOARD":
    case "UNKNOWN_UNIT":
      return "The video's files in this Project are damaged, so it can't play.";
    case "FILE_FAILED":
      return `Couldn't read or save ${error.data.path || "the Project folder"}: ${error.data.message}`;
    default:
      return "This Project was closed. Go back to Home and start again.";
  }
}

function retryErrorMessage(error: RetryError) {
  if (isDefinedError(error) && error.code === "GENERATING") {
    return "Scenes of this video are already being written. Retry once they're done.";
  }

  if (isDefinedError(error) && error.code === "NOT_FLAGGED") {
    return "Those Scenes aren't flagged any more.";
  }

  return "Couldn't start the Retry. Try again.";
}
