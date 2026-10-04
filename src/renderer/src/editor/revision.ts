import { ORPCError, safe } from "@orpc/client";
import { create } from "zustand";
import { core } from "@renderer/core/connection";
import type { RevisionError, RevisionStatus, TimelineScene, VideoRef } from "../../../contract";
import { sceneName } from "./labels";
import { useOpenVideo } from "./open-video";

/** A line in the chat: what the creator asked, what the agent said, or what happened. */
export type ChatMessage =
  | { id: number; role: "creator"; text: string; scope: string[] }
  | { id: number; role: "agent"; text: string }
  | { id: number; role: "event"; text: string }
  | { id: number; role: "note"; text: string; tone: "muted" | "fallback" };

type NewMessage = ChatMessage extends infer Message ? (Message extends ChatMessage ? Omit<Message, "id"> : never) : never;

type RevisionStore = {
  /** Scenes selected in the timeline or the player, which scope the next request; none for the whole video. */
  selection: string[];
  /** The video's Revision as the core streams it. */
  status?: RevisionStatus;
  /** This window's chat with the agent, while the video is open. */
  messages: ChatMessage[];
  /** Bumped to bring the chat forward with its composer focused, such as by Revise… on a flagged Scene. */
  chatFocus: number;
  /** Selects only this Scene, or adds it to the selection or takes it out (`additive`, with Shift or Ctrl). */
  toggleScene: (sceneId: string, additive: boolean) => void;
  clearSelection: () => void;
  /** Scopes the chat to these Scenes and brings it forward. */
  reviseScenes: (sceneIds: string[]) => void;
  /** Starts following the open video's Revisions; returns how to stop. */
  follow: (video: VideoRef) => () => void;
  /** Sends a request about the selected Scenes, or the whole video. Resolves once the core has taken it. */
  send: (text: string) => Promise<boolean>;
  stop: () => void;
};

let nextId = 1;

/** The open video's Revisions and the chat they come from: one per window. */
export const useRevision = create<RevisionStore>((set, get) => {
  let video: VideoRef | undefined;

  function say(message: NewMessage) {
    set(({ messages }) => ({ messages: [...messages, { ...message, id: nextId++ } as ChatMessage] }));
  }

  /** Says in chat how a Revision ended, once. */
  function ended(status: RevisionStatus, before: RevisionStatus | undefined) {
    if (before?.state === status.state || !before) {
      return;
    }

    const scenes = useOpenVideo.getState().preview?.timeline.scenes ?? [];

    switch (status.state) {
      case "answered":
        say({ role: "agent", text: status.reply || "No change was needed." });
        break;
      case "done":
        say({ role: "agent", text: status.summary ?? "Done." });
        say({ role: "event", text: `Version ${status.version}` });
        status.notApplied?.forEach((sceneId) => say({ role: "note", tone: "fallback", text: `Couldn't apply to ${nameOf(scenes, sceneId)}; it keeps its previous code.` }));

        if (status.previewError) {
          say({ role: "note", tone: "fallback", text: `The new Version is saved but can't be shown: ${status.previewError.message}` });
        }

        break;
      case "failed":
        say({ role: "note", tone: "fallback", text: status.error ? revisionErrorMessage(status.error) : "The Revision failed." });
        break;
      case "stopped":
        say({ role: "note", tone: "muted", text: "Stopped. The video is as it was." });
        break;
    }
  }

  return {
    selection: [],
    messages: [],
    chatFocus: 0,
    toggleScene: (sceneId, additive) =>
      set(({ selection }) => {
        const has = selection.includes(sceneId);

        if (additive) {
          return { selection: has ? selection.filter((id) => id !== sceneId) : [...selection, sceneId] };
        }

        return { selection: has && selection.length === 1 ? [] : [sceneId] };
      }),
    clearSelection: () => set({ selection: [] }),
    reviseScenes: (sceneIds) => set(({ chatFocus }) => ({ selection: sceneIds, chatFocus: chatFocus + 1 })),
    follow: (followed) => {
      video = followed;
      const controller = new AbortController();
      set({ status: undefined, selection: [], messages: [] });

      void (async () => {
        for await (const status of await core.video.revision(followed, { signal: controller.signal })) {
          const before = get().status;
          set({ status });
          ended(status, before);

          if (status.state === "done" && before?.state !== "done" && status.preview) {
            useOpenVideo.getState().showPreview(status.preview);
          }
        }
      })().catch(() => undefined);

      return () => {
        controller.abort();

        if (video === followed) {
          video = undefined;
        }
      };
    },
    send: async (text) => {
      if (!video) {
        return false;
      }

      const scope = get().selection;
      say({ role: "creator", text, scope });
      const { error } = await safe(core.video.revise({ ...video, message: text, scope }));

      if (error) {
        say({ role: "note", tone: "fallback", text: reviseErrorMessage(error) });

        return false;
      }

      set({ selection: [] });

      return true;
    },
    stop: () => {
      if (video) {
        void safe(core.video.stopRevision(video));
      }
    },
  };
});

/** Whether a Revision is underway, so the current Version plays on with its affected Scenes marked. */
export function isRevising(status: RevisionStatus | undefined) {
  return status?.state === "revising" || status?.state === "rebuilding";
}

function nameOf(scenes: TimelineScene[], sceneId: string) {
  const scene = scenes.find(({ id }) => id === sceneId);

  return scene ? sceneName(scene) : sceneId;
}

/** One sentence on why a Revision ended without a Version. */
export function revisionErrorMessage(error: RevisionError) {
  switch (error.code) {
    case "PATCH_INVALID": {
      const [first] = error.issues;

      return `The agent couldn't make a valid change after 2 retries${first ? `: ${first.message}` : "."} The video is as it was.`;
    }
    case "AGENT_FAILED":
      return `The agent couldn't run: ${error.error.message}`;
    case "CHECKER_UNAVAILABLE":
      return `The Scenes couldn't be checked: ${error.detail}`;
    case "FILE_FAILED":
      return `Couldn't save to ${error.path || "the Project folder"}: ${error.message}`;
  }
}

function reviseErrorMessage(error: unknown) {
  if (!(error instanceof ORPCError) || !error.defined) {
    return "Something went wrong talking to the MotionBrief core. Try again.";
  }

  switch (error.code) {
    case "REVISING":
      return "A Revision is already running. Wait for it, or stop it.";
    case "NOT_GENERATED":
      return "The video can be revised once it is generated.";
    case "UNKNOWN_SCENE":
      return "A selected Scene isn't in the video any more. Select the Scenes again.";
    case "UNKNOWN_PROJECT":
      return "This Project was closed. Go back to Home and open it again.";
    default:
      return `Couldn't start the Revision: ${error.message}`;
  }
}
