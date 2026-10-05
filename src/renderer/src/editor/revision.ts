import { ORPCError, safe } from "@orpc/client";
import { create } from "zustand";
import { core } from "@renderer/core/connection";
import { costLabel } from "@renderer/new-project/generate-bar";
import type {
  ChatEntry,
  ChatRequestState,
  ChatStatus,
  ConnectorError,
  GenerationStop,
  RevisionError,
  RevisionStatus,
  TimelineScene,
  VideoRef,
  WordFixOffer,
} from "../../../contract";
import { stopHeadline, useGeneration } from "./generation";
import { sceneName } from "./labels";
import { useOpenVideo, type SavedWordFix } from "./open-video";

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
  /** A note that Claude's login failed, which offers Reconnect. */
  canReconnect?: boolean;
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
  /** Approves the estimated cost of the Scenes a Revision waiting in `approval` regenerates. */
  approve: () => void;
  /** Runs the queue paused by a quit, a crash or a Stop. */
  resumeQueue: () => void;
  stop: () => void;
  /** The Revision offered after the last word fix, when the old word is still on screen; cleared once taken or dismissed. */
  wordFixOffer?: WordFixOffer;
  /** Sends the offered Revision, scoped to the Scenes that still say the old word. */
  carryWordFix: () => Promise<void>;
  /** Declines the offer: nothing else changes. */
  dismissWordFix: () => void;
};

let nextNote = 1;

/** The open video's Revisions and the chat they come from: one per window. */
export const useRevision = create<RevisionStore>((set, get) => {
  let video: VideoRef | undefined;

  function note(text: string) {
    set(({ notes }) => ({ notes: [...notes, { id: `note-${nextNote++}`, role: "note", isProblem: true, text }] }));
  }

  /** Sends a request scoped to `scope` through the chat's queue: it runs now when the video is idle, else waits its turn. */
  async function request(text: string, scope: string[]): Promise<boolean> {
    if (!video) {
      return false;
    }

    const { error } = await safe(core.video.send({ ...video, message: text, scope }));

    if (error) {
      note(sendErrorMessage(error));

      return false;
    }

    return true;
  }

  /**
   * Asks the core whether the followed video's copy still says the fixed word as it was; offers a Revision if so.
   * The previous offer is withdrawn at once, and only the answer for the latest fix is kept.
   */
  async function offerFor(followed: VideoRef, fix: SavedWordFix) {
    set({ wordFixOffer: undefined });
    const { data: offer } = await safe(core.video.wordFixOffer({ ...followed, index: fix.index, previous: fix.previous }));

    if (video === followed && useOpenVideo.getState().lastFix === fix) {
      set({ wordFixOffer: offer ?? undefined });
    }
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
      set({ status: undefined, chat: undefined, selection: [], notes: [], wordFixOffer: undefined });
      // Every saved word fix may leave the old word in on-screen copy.
      const unsubscribe = useOpenVideo.subscribe(({ lastFix }, before) => {
        if (lastFix && lastFix !== before.lastFix) {
          void offerFor(followed, lastFix);
        }
      });

      void (async () => {
        for await (const status of await core.video.revision(followed, { signal: controller.signal })) {
          const before = get().status;
          set({ status });

          // A failed login stopped the Revision: reconnect before sending it again.
          if (isLoginStop(status) && !isLoginStop(before)) {
            useGeneration.getState().askToReconnect();
          }

          // The new Version plays as `video.open` builds it: with the video's Captions choice and its review notes.
          if (status.state === "done" && before?.state !== "done" && status.version !== undefined) {
            useGeneration.getState().reopen();

            // Not kept in the log: the next open builds the preview again.
            if (status.previewError) {
              note(`The new Version is saved but can't be shown: ${status.previewError.message}`);
            }
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
        unsubscribe();

        if (video === followed) {
          video = undefined;
        }
      };
    },
    send: async (text) => {
      const isSent = await request(text, get().selection);

      if (isSent) {
        set({ selection: [] });
      }

      return isSent;
    },
    approve: () => {
      if (video) {
        void safe(core.video.approveRevision(video));
      }
    },
    resumeQueue: () => {
      if (video) {
        void safe(core.video.resumeQueue(video));
      }
    },
    carryWordFix: async () => {
      const offer = get().wordFixOffer;

      if (!offer) {
        return;
      }

      set({ wordFixOffer: undefined });
      await request(offer.message, offer.scope);
    },
    dismissWordFix: () => set({ wordFixOffer: undefined }),
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
  return status?.state === "revising" || status?.state === "approval" || status?.state === "rebuilding" || status?.state === "saving";
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

/** The connector errors that stop a Revision as Stop does, by the stop they read as. */
const STOPPED_BY: Partial<Record<ConnectorError["code"], GenerationStop["cause"]>> = {
  COST_CAP: "cost-cap",
  PLAN_LIMIT: "plan-limit",
  AUTHENTICATION_FAILED: "authentication",
};

/** Why a Revision stopped, such as "Plan limit reached, resets at 15:00"; the creator's own Stop otherwise. */
function stopOf(error: RevisionError | undefined): GenerationStop {
  if (error?.code !== "AGENT_FAILED") {
    return { cause: "stopped" };
  }

  return { cause: STOPPED_BY[error.error.code] ?? "stopped", resetsAt: error.error.resetsAt };
}

/** A Revision stopped by a failed login: Reconnect, then send the request again. */
export function isLoginStop(status: Pick<RevisionStatus, "state" | "error"> | undefined) {
  return status?.state === "stopped" && stopOf(status.error).cause === "authentication";
}

function stoppedLine(entry: ChatEntry): NewMessage {
  const text = `${stopHeadline(stopOf(entry.error))}. The video is as it was.`;

  if (isLoginStop({ state: "stopped", error: entry.error })) {
    return { role: "note", isProblem: true, text, canReconnect: true };
  }

  return { role: "note", text };
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
  stopped: (entry) => [stoppedLine(entry)],
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

  return [{ role: "creator", text: entry.message ?? "", scope: entry.scope, isQueued: state === "queued" }, ...approvedLines(entry), ...OUTCOMES[state](entry, scenes)];
}

function approvedLines({ approvedUsd }: ChatEntry): NewMessage[] {
  if (!approvedUsd) {
    return [];
  }

  return [{ role: "event", text: `Approved about ${costLabel(approvedUsd)}` }];
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
