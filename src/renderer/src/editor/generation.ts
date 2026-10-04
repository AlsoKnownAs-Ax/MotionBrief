import { ORPCError, safe } from "@orpc/client";
import { create } from "zustand";
import { core, orpc, queryClient } from "@renderer/core/connection";
import { useNavigation } from "@renderer/navigation";
import { projectErrorMessage } from "@renderer/new-project/project-errors";
import type { GenerationError, GenerationStatus, GenerationStop, Project, VideoRef } from "../../../contract";
import { useOpenVideo } from "./open-video";

type GenerationStore = {
  /** The open video's generation; absent for a video that wasn't generated in this window. */
  status?: GenerationStatus;
  /** Why the window stopped hearing about the generation, such as the core going away. */
  lostError?: string;
  /** Stop was pressed and the run is saving what it keeps. */
  isStopping: boolean;
  /** Why the last Retry couldn't start. */
  retryError?: string;
  /** Claude's login failed mid-run: the Reconnect prompt is open. */
  isReconnectOpen: boolean;
  /** Opens the video in the editor and follows its generation: the preview updates as units finish. */
  follow: (project: Project, video: VideoRef) => void;
  /** Listens to the generation again after losing it; the core kept it going. */
  reconnect: () => void;
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
let followed: { project: Project; video: VideoRef } | undefined;

/** The generation the editor shows: one per window. */
export const useGeneration = create<GenerationStore>((set, get) => {
  function listen() {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    set({ lostError: undefined });

    if (!followed) {
      return;
    }

    void (async () => {
      for await (const status of await core.video.generation(followed.video, { signal: current.signal })) {
        const before = get().status;
        set({ status });

        if (status.preview) {
          useOpenVideo.getState().showPreview(status.preview);
        }

        if (status.stopped?.cause === "authentication" && before?.stopped?.cause !== "authentication") {
          // The login is checked again, so the prompt shows where it stands now.
          void queryClient.invalidateQueries({ queryKey: orpc.connection.status.queryKey() });
          set({ isReconnectOpen: true });
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

  function unfollow() {
    controller?.abort();
    controller = undefined;
    followed = undefined;
    set({ status: undefined, lostError: undefined, isStopping: false, retryError: undefined, isReconnectOpen: false });
  }

  return {
    isStopping: false,
    isReconnectOpen: false,
    follow: (project, video) => {
      useOpenVideo.getState().open({ ...project, isStored: true });
      set({ status: undefined, retryError: undefined });
      followed = { project, video };
      listen();
    },
    reconnect: listen,
    stop: async () => {
      if (!followed) {
        return;
      }

      set({ isStopping: true });
      await safe(core.video.stop(followed.video));
      set({ isStopping: false });
    },
    retry: async (units) => {
      if (!followed) {
        return;
      }

      set({ retryError: undefined });
      const { error } = await safe(core.video.retry({ ...followed.video, units }));

      if (error) {
        set({ retryError: retryErrorMessage(error) });
      }
    },
    setReconnectOpen: (isOpen) => set({ isReconnectOpen: isOpen }),
    backToProject: () => {
      const project = followed?.project;
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
  NOT_GENERATED: "This video has no Version to retry Scenes in yet.",
  NOT_FLAGGED: "Those Scenes aren't fallbacks any more.",
};

function retryErrorMessage(error: unknown) {
  if (error instanceof ORPCError && error.defined && error.code in RETRY_MESSAGES) {
    return RETRY_MESSAGES[error.code];
  }

  return projectErrorMessage(error);
}

/** What ended a run early, such as "Plan limit reached, resets at 15:00". */
export function stopHeadline({ cause, resetsAt }: GenerationStop, now = new Date()) {
  switch (cause) {
    case "stopped":
      return "Stopped";
    case "plan-limit":
      return resetsAt === undefined ? "Plan limit reached" : `Plan limit reached, resets at ${resetTime(new Date(resetsAt), now)}`;
    case "authentication":
      return "Claude was disconnected";
    case "closed":
      return "Stopped when the Project closed";
  }
}

/** "15:00" today, "Tue 15:00" within the week, otherwise the date too. */
function resetTime(at: Date, now: Date) {
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (at.toDateString() === now.toDateString()) {
    return time;
  }

  const days = (at.getTime() - now.getTime()) / 86_400_000;
  const day = days < 7 ? at.toLocaleDateString([], { weekday: "short" }) : at.toLocaleDateString([], { month: "short", day: "numeric" });

  return `${day} ${time}`;
}
