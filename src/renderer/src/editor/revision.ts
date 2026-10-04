import { ORPCError, safe } from "@orpc/client";
import { create } from "zustand";
import { core } from "@renderer/core/connection";
import type { ChatEntry, ChatRequestState, ChatStatus, RevisionError, RevisionStatus, TimelineScene, VideoRef } from "../../../contract";
import { useGeneration } from "./generation";
import { sceneName } from "./labels";

/** A line in the chat: what the creator asked (with the Scenes it was about), what the agent said, or what happened. */
export type ChatMessage = {
  id: string;
  role: "creator" | "agent" | "event" | "note";
  text: string;
  /** The Scenes a creator's request was scoped to. */
  scope?: string[];
  /** A creator's request waiting its turn. */
  isQueued?: boolean;
  /** A note that something went wrong, rather than one for information. */
  isProblem?: boolean;
};

type RevisionStore = {
  /** Scenes selected in the timeline or the player, which scope the next request; none for the whole video. */
  selection: string[];
  /** The video's Revision as the core streams it. */
  status?: RevisionStatus;
  /** The video's chat as saved with it: requests, how each went, Restores, and whether the queue is paused. */
  chat?: ChatStatus;
  /** This window's notes on requests the core wouldn't take. */
  notes: ChatMessage[];
  /** Bumped to bring the chat forward with its composer focused, such as by Revise… on a flagged Scene. */
  chatFocus: number;
  /** Selects only this Scene, or adds it to the selection or takes it out (`additive`, with Shift or Ctrl). */
  toggleScene: (sceneId: string, additive: boolean) => void;
  clearSelection: () => void;
  /** Scopes the chat to these Scenes and brings it forward. */
  reviseScenes: (sceneIds: string[]) => void;
  /** Starts following the open video's chat and Revisions; returns how to stop. */
  follow: (video: VideoRef) => () => void;
  /** Sends a request about the selected Scenes, or the whole video; it queues while the video is busy. */
  send: (text: string) => Promise<boolean>;
  /** Runs the queue paused by a quit, a crash or a Stop. */
  resumeQueue: () => void;
  stop: () => void;
};

let nextNote = 1;

/** The open video's Revisions and the chat they come from: one per window. */
export const useRevision = create<RevisionStore>((set, get) => {
  let video: VideoRef | undefined;

  function note(text: string) {
    set(({ notes }) => ({ notes: [...notes, { id: `note-${nextNote++}`, role: "note", isProblem: true, text }] }));
  }

  return {
    selection: [],
    notes: [],
    chatFocus: 0,
    toggleScene: (sceneId, additive) => set(({ selection }) => ({ selection: toggled(selection, sceneId, additive) })),
    clearSelection: () => set({ selection: [] }),
    reviseScenes: (sceneIds) => set(({ chatFocus }) => ({ selection: sceneIds, chatFocus: chatFocus + 1 })),
    follow: (followed) => {
      video = followed;
      const controller = new AbortController();
      set({ status: undefined, chat: undefined, selection: [], notes: [] });

      void (async () => {
        for await (const status of await core.video.revision(followed, { signal: controller.signal })) {
          const before = get().status;
          set({ status });

          // The new Version plays as `video.open` builds it: with the video's Captions choice and its review notes.
          if (status.state === "done" && before?.state !== "done" && status.version !== undefined) {
            useGeneration.getState().reopen();
          }
        }
      })().catch(() => undefined);

      void (async () => {
        for await (const chat of await core.video.chat(followed, { signal: controller.signal })) {
          set({ chat });
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
      const { error } = await safe(core.video.send({ ...video, message: text, scope }));

      if (error) {
        note(sendErrorMessage(error));

        return false;
      }

      set({ selection: [] });

      return true;
    },
    resumeQueue: () => {
      if (video) {
        void safe(core.video.resumeQueue(video));
      }
    },
    stop: () => {
      if (video) {
        void safe(core.video.stopRevision(video));
      }
    },
  };
});

/** A plain click selects only the Scene, or clears it when it is the only one; Shift or Ctrl adds or removes it. */
function toggled(selection: string[], sceneId: string, additive: boolean): string[] {
  const has = selection.includes(sceneId);

  if (additive && has) {
    return selection.filter((id) => id !== sceneId);
  }

  if (additive) {
    return [...selection, sceneId];
  }

  if (has && selection.length === 1) {
    return [];
  }

  return [sceneId];
}

/** Whether a Revision is underway, so the current Version plays on with its affected Scenes marked. */
export function isRevising(status: RevisionStatus | undefined) {
  return status?.state === "revising" || status?.state === "rebuilding" || status?.state === "saving";
}

/** The requests waiting their turn. */
export function queuedCount(chat: ChatStatus | undefined) {
  return chat?.entries.filter(({ state }) => state === "queued").length ?? 0;
}

export function nameOf(scenes: TimelineScene[], sceneId: string) {
  const scene = scenes.find(({ id }) => id === sceneId);

  if (!scene) {
    return sceneId;
  }

  return sceneName(scene);
}

type NewMessage = Omit<ChatMessage, "id">;

/** What the chat says after a request, by where it stands; a request still waiting or running says nothing yet. */
const OUTCOMES = {
  queued: () => [],
  running: () => [],
  answered: ({ reply }) => [{ role: "agent", text: reply || "No change was needed." }],
  done: ({ summary, version, notApplied = [] }, scenes) => [
    { role: "agent", text: summary ?? "Done." },
    { role: "event", text: `Version ${version}` },
    ...notApplied.map((sceneId) => ({ role: "note" as const, isProblem: true, text: `Couldn't apply to ${nameOf(scenes, sceneId)}; it keeps its previous code.` })),
  ],
  failed: ({ error }) => [{ role: "note", isProblem: true, text: failureText(error) }],
  stopped: () => [{ role: "note", text: "Stopped. The video is as it was." }],
  closed: () => [{ role: "note", text: "MotionBrief closed before this Revision finished. The video is as it was." }],
  refused: ({ refused }) => [{ role: "note", isProblem: true, text: REFUSALS[refused ?? ""] ?? "This request couldn't run." }],
} satisfies Record<ChatRequestState, (entry: ChatEntry, scenes: TimelineScene[]) => NewMessage[]>;

/** Why a queued request couldn't run once its turn came, per error code. */
const REFUSALS: Record<string, string> = {
  NOT_GENERATED: "This couldn't run: the video had no Version to revise.",
  UNKNOWN_SCENE: "This couldn't run: a Scene it was about isn't in the video any more.",
  UNKNOWN_PROJECT: "This couldn't run: the Project was closed.",
};

/** The chat's lines, in the order they happened. */
export function chatLines(entries: ChatEntry[], scenes: TimelineScene[]): ChatMessage[] {
  return entries.flatMap((entry) => entryLines(entry, scenes).map((line, index) => ({ ...line, id: `${entry.id}-${index}` })));
}

function entryLines(entry: ChatEntry, scenes: TimelineScene[]): NewMessage[] {
  if (entry.kind === "restore") {
    return [{ role: "event", text: `Version ${entry.version} · Restored Version ${entry.restoredFrom}` }];
  }

  const state = entry.state ?? "queued";

  return [{ role: "creator", text: entry.message ?? "", scope: entry.scope, isQueued: state === "queued" }, ...OUTCOMES[state](entry, scenes)];
}

function failureText(error: RevisionError | undefined) {
  if (!error) {
    return "The Revision failed.";
  }

  return revisionErrorMessage(error);
}

/** One sentence on why a Revision ended without a Version, per error code. */
const REVISION_ERRORS = {
  PATCH_INVALID: ({ issues: [first] }) => `The agent couldn't make a valid change after 2 retries${issueText(first)} The video is as it was.`,
  AGENT_FAILED: ({ error }) => `The agent couldn't run: ${error.message}`,
  CHECKER_UNAVAILABLE: ({ detail }) => `The Scenes couldn't be checked: ${detail}`,
  FILE_FAILED: ({ path, message }) => `Couldn't save to ${path || "the Project folder"}: ${message}`,
} satisfies { [Code in RevisionError["code"]]: (error: Extract<RevisionError, { code: Code }>) => string };

export function revisionErrorMessage(error: RevisionError) {
  // The table is keyed by code, so each entry receives the error of its own code.
  return (REVISION_ERRORS[error.code] as (error: RevisionError) => string)(error);
}

function issueText(issue: { message: string } | undefined) {
  if (!issue) {
    return ".";
  }

  return `: ${issue.message}`;
}

/** Why the core wouldn't take a request, per error code it answers with. */
const SEND_ERRORS: Record<string, string> = {
  UNKNOWN_PROJECT: "This Project was closed. Go back to Home and open it again.",
  FILE_FAILED: "The request couldn't be saved in the Project folder. Try again.",
};

function sendErrorMessage(error: unknown) {
  if (!(error instanceof ORPCError) || !error.defined) {
    return "Something went wrong talking to the MotionBrief core. Try again.";
  }

  return SEND_ERRORS[error.code] ?? `Couldn't send the request: ${error.message}`;
}
