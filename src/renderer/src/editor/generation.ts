import { ORPCError, safe } from "@orpc/client";
import { create } from "zustand";
import { core, orpc, queryClient } from "@renderer/core/connection";
import { useNavigation } from "@renderer/navigation";
import { projectErrorMessage } from "@renderer/new-project/project-errors";
import type { Format, GenerationError, GenerationStatus, GenerationStop, OpenedVideo, Project, VideoRef } from "../../../contract";
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
  /** Stop was pressed and the run is saving what it keeps. */
  isStopping: boolean;
  /** Why the last Retry couldn't start. */
  retryError?: string;
  /** Claude's login failed mid-run: the Reconnect prompt is open. */
  isReconnectOpen: boolean;
  /**
   * Opens the video in the editor and follows its generation: the preview updates as units finish. A saved video
   * opens at its newest Version, already `opened` when the caller opened it, and follows any Retry of its flagged Scenes.
   */
  follow: (project: Project, video: VideoRef, opened?: OpenedVideo) => void;
  /** Shows the open Project's video in another Format, or its empty state when it has none yet. */
  showFormat: (format: Format) => void;
  /** Listens to the generation again after losing it; the core kept it going. */
  reconnect: () => void;
  /** Plays the open Format's newest saved Version again, such as one a Revision just saved. */
  reopen: () => void;
  /** Stops the run; finished Scenes are kept and the rest become flagged fallbacks. */
  stop: () => Promise<void>;
  /** Regenerates flagged fallback units: these, or every flagged one. */
  retry: (units?: string[]) => Promise<void>;
  setReconnectOpen: (isOpen: boolean) => void;
  /** Back to the Project screen, keeping the Project open, after a stop before there was a video. */
  backToProject: () => void;
  /** Stops following and releases the Project, when the creator leaves the editor. */
  leave: () => void;
};

let controller: AbortController | undefined;
let followed: Project | undefined;

/** The generation the editor shows: one per window. */
export const useGeneration = create<GenerationStore>((set, get) => {
  function listen(video: VideoRef) {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    set({ lostError: undefined });

    void (async () => {
      for await (const status of await core.video.generation(video, { signal: current.signal })) {
        const before = get().status;

        // Opening the saved Version resets a finished run to idle; the window keeps showing how the run ended.
        if (status.state === "idle" && before?.state === "done") {
          continue;
        }

        set({ status });

        // Once done, the saved Version plays: it has the Transcript's newest word fixes.
        if (status.preview && status.state !== "done") {
          useOpenVideo.getState().showPreview(status.preview);
        }

        if (status.stopped?.cause === "authentication" && before?.stopped?.cause !== "authentication") {
          // The login is checked again, so the prompt shows where it stands now.
          void queryClient.invalidateQueries({ queryKey: orpc.connection.status.queryKey() });
          set({ isReconnectOpen: true });
        }

        if (status.state === "done" && before?.state !== "done") {
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

    showOpened(opened);
  }

  function showOpened(opened: OpenedVideo) {
    set({ stored: { isLoading: false, version: opened.version, captions: opened.captions } });

    if (opened.preview && !isGenerating(get().status)) {
      useOpenVideo.getState().showPreview(opened.preview);
    }
  }

  /** Follows the video's generation and plays its saved Version; a fixed word rebuilds it so its Captions show the fix. */
  function show(video: VideoRef, opened?: OpenedVideo) {
    set({ video, status: undefined, stored: { isLoading: true }, retryError: undefined });
    useOpenVideo.setState({ onWordFixed: () => void openStored(video) });
    listen(video);

    if (opened) {
      showOpened(opened);
    } else {
      void openStored(video);
    }
  }

  function unfollow() {
    controller?.abort();
    controller = undefined;
    followed = undefined;
    set({ video: undefined, status: undefined, stored: undefined, lostError: undefined, isStopping: false, retryError: undefined, isReconnectOpen: false });
    useOpenVideo.setState({ onWordFixed: undefined });
  }

  return {
    isStopping: false,
    isReconnectOpen: false,
    follow: (project, video, opened) => {
      useOpenVideo.getState().open({ ...project, isStored: true }, opened?.preview);
      followed = project;
      show(video, opened);
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
    reopen: () => {
      const { video } = get();

      if (video) {
        void openStored(video);
      }
    },
    stop: async () => {
      const { video } = get();

      if (!video) {
        return;
      }

      set({ isStopping: true });
      await safe(core.video.stop(video));
      set({ isStopping: false });
    },
    retry: async (units) => {
      const { video } = get();

      if (!video) {
        return;
      }

      set({ retryError: undefined });
      const { error } = await safe(core.video.retry({ ...video, units }));

      if (error) {
        set({ retryError: retryErrorMessage(error) });
      }
    },
    setReconnectOpen: (isOpen) => set({ isReconnectOpen: isOpen }),
    backToProject: () => {
      const project = followed;
      unfollow();

      if (project) {
        useNavigation.getState().openProject(project);
      }
    },
    leave: () => {
      const { projectId, isStored } = useOpenVideo.getState();
      unfollow();
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

const RETRY_MESSAGES: Record<string, string> = {
  GENERATING: "Wait for the run going now to finish, or stop it, then retry.",
  NO_VIDEO: "This video has no Version to retry Scenes in yet.",
  NOT_FLAGGED: "Those Scenes aren't flagged any more.",
};

function retryErrorMessage(error: unknown) {
  if (error instanceof ORPCError && error.defined && error.code in RETRY_MESSAGES) {
    return RETRY_MESSAGES[error.code];
  }

  return projectErrorMessage(error);
}

const STOP_HEADLINES = {
  stopped: () => "Stopped",
  "plan-limit": planLimitHeadline,
  "cost-cap": () => "Cost cap reached",
  authentication: () => "Claude was disconnected",
  closed: () => "Stopped when the Project closed",
} satisfies Record<GenerationStop["cause"], (stop: GenerationStop, now: Date) => string>;

/** What ended a run early, such as "Plan limit reached, resets at 15:00". */
export function stopHeadline(stop: GenerationStop, now = new Date()) {
  return STOP_HEADLINES[stop.cause](stop, now);
}

function planLimitHeadline({ resetsAt }: GenerationStop, now: Date) {
  if (resetsAt === undefined) {
    return "Plan limit reached";
  }

  return `Plan limit reached, resets at ${resetTime(new Date(resetsAt), now)}`;
}

const WEEK_MS = 7 * 86_400_000;

/** "15:00" today, "Tue 15:00" within the week, otherwise the date too. */
function resetTime(at: Date, now: Date) {
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (at.toDateString() === now.toDateString()) {
    return time;
  }

  if (at.getTime() - now.getTime() < WEEK_MS) {
    return `${at.toLocaleDateString([], { weekday: "short" })} ${time}`;
  }

  return `${at.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}
