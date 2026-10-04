import { ORPCError, safe } from "@orpc/client";
import { create } from "zustand";
import { core } from "@renderer/core/connection";
import { projectErrorMessage } from "@renderer/new-project/project-errors";
import type { Format, GenerationError, GenerationStatus, VideoRef } from "../../../contract";
import { useOpenVideo } from "./open-video";
import { usePlayback } from "./playback";

/** The open Format's saved video: its newest Version (none before the first is saved), or why it couldn't be opened. */
export type StoredVideo = {
  isLoading: boolean;
  version?: number;
  /** Whether it shows Captions, or will once generated, as the creator chose; absent for the Format's default. */
  captions?: boolean;
  error?: string;
};

type GenerationStore = {
  /** The video the editor shows: the open Project and Format. */
  video?: VideoRef;
  /** The open video's generation; absent for a video that wasn't generated in this window. */
  status?: GenerationStatus;
  /** The open Format's video as the Project has it saved. */
  stored?: StoredVideo;
  /** Why the window stopped hearing about the generation, such as the core going away. */
  lostError?: string;
  /** Opens the video in the editor and follows its generation: the preview updates as units finish. */
  follow: (project: { id: string; name: string }, video: VideoRef) => void;
  /** Shows the open Project's video in another Format, or its empty state when it has none yet. */
  showFormat: (format: Format) => void;
  /** Listens to the generation again after losing it; the core kept it going. */
  reconnect: () => void;
  /** Stops following and releases the Project, when the creator leaves the editor. */
  leave: () => void;
};

let controller: AbortController | undefined;

/** The generation the editor shows: one per window. */
export const useGeneration = create<GenerationStore>((set, get) => {
  function listen(video: VideoRef) {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    set({ lostError: undefined });

    void (async () => {
      for await (const status of await core.video.generation(video, { signal: current.signal })) {
        const isNewlyDone = status.state === "done" && get().status?.state !== "done";
        set({ status });

        // Once done, the saved Version plays: it has the Transcript's newest word fixes.
        if (status.preview && status.state !== "done") {
          useOpenVideo.getState().showPreview(status.preview);
        }

        if (isNewlyDone) {
          void openStored(video);
        }
      }

      // The stream only ends on its own when the core went away.
      if (!current.signal.aborted && isGenerating(get().status)) {
        set({ lostError: "The core stopped sending updates." });
      }
    })().catch((error: unknown) => {
      if (!current.signal.aborted) {
        set({ lostError: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  /** Looks up the Format's saved video and plays it, unless a generation of it is still writing it. */
  async function openStored(video: VideoRef) {
    set(({ stored }) => ({ stored: { ...stored, isLoading: true } }));
    const { data: opened, error } = await safe(core.video.open(video));

    if (get().video !== video) {
      return;
    }

    if (error) {
      set({ stored: { isLoading: false, error: openErrorMessage(error) } });
      return;
    }

    set({ stored: { isLoading: false, version: opened.version, captions: opened.captions } });

    if (opened.preview && !isGenerating(get().status)) {
      useOpenVideo.getState().showPreview(opened.preview);
    }
  }

  /** Follows the video's generation and plays its saved Version; a fixed word rebuilds it so its Captions show the fix. */
  function show(video: VideoRef) {
    set({ video, status: undefined, stored: { isLoading: true } });
    useOpenVideo.setState({ onWordFixed: () => void openStored(video) });
    listen(video);
    void openStored(video);
  }

  return {
    follow: (project, video) => {
      useOpenVideo.getState().open({ ...project, isStored: true });
      show(video);
    },
    showFormat: (format) => {
      const { video } = get();

      if (!video || video.format === format) {
        return;
      }

      // Both Formats share the Transcript, so word fixes carry over; only the player changes.
      usePlayback.setState({ resumes: false });
      useOpenVideo.setState({ preview: undefined });
      show({ projectId: video.projectId, format });
    },
    reconnect: () => {
      const { video } = get();

      if (video) {
        listen(video);
      }
    },
    leave: () => {
      controller?.abort();
      controller = undefined;
      const { projectId, isStored } = useOpenVideo.getState();
      set({ video: undefined, status: undefined, stored: undefined, lostError: undefined });
      useOpenVideo.setState({ onWordFixed: undefined });

      if (isStored) {
        void safe(core.project.close({ projectId }));
      }
    },
  };
});

/** Whether the generation is still writing the video, so it isn't complete yet. */
export function isGenerating(status: GenerationStatus | undefined) {
  return status?.state === "planning" || status?.state === "writing";
}

const STORYBOARD_UNFIT = "This video's saved Storyboard doesn't fit its Transcript any more, so it can't play.";

const OPEN_MESSAGES: Record<string, string> = {
  VOICEOVER_MISSING: "The Voiceover isn't in the Project folder any more, so this video can't play.",
  INVALID_STORYBOARD: STORYBOARD_UNFIT,
  UNKNOWN_UNIT: STORYBOARD_UNFIT,
};

/** One sentence on why a saved video can't be played. */
function openErrorMessage(error: unknown) {
  if (error instanceof ORPCError && error.defined && error.code in OPEN_MESSAGES) {
    return OPEN_MESSAGES[error.code];
  }

  return projectErrorMessage(error);
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
