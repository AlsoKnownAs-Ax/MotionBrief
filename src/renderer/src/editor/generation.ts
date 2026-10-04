import { safe } from "@orpc/client";
import { create } from "zustand";
import { core } from "@renderer/core/connection";
import type { GenerationError, GenerationStatus, VideoRef } from "../../../contract";
import { useOpenVideo } from "./open-video";

type GenerationStore = {
  /** The open video's generation; absent for a video that wasn't generated in this window. */
  status?: GenerationStatus;
  /** Why the window stopped hearing about the generation, such as the core going away. */
  lostError?: string;
  /** Opens the video in the editor and follows its generation: the preview updates as units finish. */
  follow: (project: { id: string; name: string }, video: VideoRef) => void;
  /** Stops following and releases the Project, when the creator leaves the editor. */
  leave: () => void;
};

let controller: AbortController | undefined;

/** The generation the editor shows: one per window. */
export const useGeneration = create<GenerationStore>((set) => ({
  follow: (project, video) => {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    useOpenVideo.getState().open({ ...project, isStored: true });
    set({ status: undefined, lostError: undefined });

    void (async () => {
      for await (const status of await core.video.generation(video, { signal: current.signal })) {
        set({ status });

        if (status.preview) {
          useOpenVideo.getState().showPreview(status.preview);
        }
      }
    })().catch((error: unknown) => {
      if (!current.signal.aborted) {
        set({ lostError: error instanceof Error ? error.message : String(error) });
      }
    });
  },
  leave: () => {
    controller?.abort();
    controller = undefined;
    const { projectId, isStored } = useOpenVideo.getState();
    set({ status: undefined, lostError: undefined });

    if (isStored) {
      void safe(core.project.close({ projectId }));
    }
  },
}));

/** Whether the generation is still writing the video, so it isn't complete yet. */
export function isGenerating(status: GenerationStatus | undefined) {
  return status?.state === "planning" || status?.state === "writing";
}

/** One sentence on why a generation ended without a video. */
export function generationErrorMessage(error: GenerationError) {
  switch (error.code) {
    case "STORYBOARD_INVALID": {
      const [first] = error.issues;

      return `The agent couldn't write a valid Storyboard after 2 retries${first ? `: ${first.message}` : "."}`;
    }
    case "AGENT_FAILED":
      return `The agent couldn't run: ${error.error.message}`;
    case "FILE_FAILED":
      return `Couldn't save to ${error.path || "the Project folder"}: ${error.message}`;
  }
}
