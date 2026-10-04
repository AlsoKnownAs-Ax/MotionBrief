import { ORPCError, safe } from "@orpc/client";
import { create } from "zustand";
import { core } from "@renderer/core/connection";
import type { RevisionError, RevisionStatus, TimelineScene, VideoRef, WordFixOffer } from "../../../contract";
import { useGeneration } from "./generation";
import { sceneName } from "./labels";
import { useOpenVideo, type SavedWordFix } from "./open-video";

/** A line in the chat: what the creator asked (with the Scenes it was about), what the agent said, or what happened. */
export type ChatMessage = {
  id: number;
  role: "creator" | "agent" | "event" | "note";
  text: string;
  /** The Scenes a creator's request was scoped to. */
  scope?: string[];
  /** A note that something went wrong, rather than one for information. */
  isProblem?: boolean;
};

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
  /** Approves the estimated cost of the Scenes a Revision waiting in `approval` regenerates. */
  approve: () => void;
  stop: () => void;
  /** The Revision offered after the last word fix, when the old word is still on screen; cleared once taken or dismissed. */
  wordFixOffer?: WordFixOffer;
  /** Sends the offered Revision, scoped to the Scenes that still say the old word. */
  carryWordFix: () => Promise<void>;
  /** Declines the offer: nothing else changes. */
  dismissWordFix: () => void;
};

type NewMessage = Omit<ChatMessage, "id">;

/** What the chat says when a Revision ends in each way; states that don't end one say nothing. */
const ENDINGS: Partial<Record<RevisionStatus["state"], (status: RevisionStatus, scenes: TimelineScene[]) => NewMessage[]>> = {
  answered: ({ reply }) => [{ role: "agent", text: reply || "No change was needed." }],
  done: ({ summary, version, notApplied = [], previewError }, scenes) => [
    { role: "agent", text: summary ?? "Done." },
    { role: "event", text: `Version ${version}` },
    ...notApplied.map((sceneId) => ({ role: "note" as const, isProblem: true, text: `Couldn't apply to ${nameOf(scenes, sceneId)}; it keeps its previous code.` })),
    ...[previewError]
      .filter((problem) => problem !== undefined)
      .map((problem) => ({ role: "note" as const, isProblem: true, text: `The new Version is saved but can't be shown: ${problem.message}` })),
  ],
  failed: ({ error }) => [{ role: "note", isProblem: true, text: failureText(error) }],
  stopped: ({ error }) => [{ role: "note", text: stoppedText(error) }],
};

let nextId = 1;

/** The open video's Revisions and the chat they come from: one per window. */
export const useRevision = create<RevisionStore>((set, get) => {
  let video: VideoRef | undefined;

  function say(...messages: NewMessage[]) {
    set((state) => ({ messages: [...state.messages, ...messages.map((message) => ({ ...message, id: nextId++ }))] }));
  }

  /** Says in chat how a Revision ended, once: a status already ended before this window followed says nothing. */
  function ended(status: RevisionStatus, before: RevisionStatus | undefined) {
    if (!before || before.state === status.state) {
      return;
    }

    say(...(ENDINGS[status.state]?.(status, useOpenVideo.getState().preview?.timeline.scenes ?? []) ?? []));
  }

  /** Sends a request scoped to `scope`, saying it in chat first. */
  async function request(text: string, scope: string[]): Promise<boolean> {
    if (!video) {
      return false;
    }

    say({ role: "creator", text, scope });
    const { error } = await safe(core.video.revise({ ...video, message: text, scope }));

    if (error) {
      say({ role: "note", isProblem: true, text: reviseErrorMessage(error) });

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
    messages: [],
    chatFocus: 0,
    toggleScene: (sceneId, additive) => set(({ selection }) => ({ selection: toggled(selection, sceneId, additive) })),
    clearSelection: () => set({ selection: [] }),
    reviseScenes: (sceneIds) => set(({ chatFocus }) => ({ selection: sceneIds, chatFocus: chatFocus + 1 })),
    follow: (followed) => {
      video = followed;
      const controller = new AbortController();
      set({ status: undefined, selection: [], messages: [], wordFixOffer: undefined });
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
          ended(status, before);

          // The new Version plays as `video.open` builds it: with the video's Captions choice and its review notes.
          if (status.state === "done" && before?.state !== "done" && status.version !== undefined) {
            useGeneration.getState().reopen();
          }
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

export function nameOf(scenes: TimelineScene[], sceneId: string) {
  const scene = scenes.find(({ id }) => id === sceneId);

  if (!scene) {
    return sceneId;
  }

  return sceneName(scene);
}

function stoppedText(error: RevisionError | undefined) {
  if (error?.code === "AGENT_FAILED" && error.error.code === "COST_CAP") {
    return "Cost cap reached. The video is as it was.";
  }

  return "Stopped. The video is as it was.";
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

/** Why the core wouldn't start a Revision, per error code it answers with. */
const REVISE_ERRORS: Record<string, string> = {
  REVISING: "A Revision is already running. Wait for it, or stop it.",
  NOT_GENERATED: "The video can be revised once it is generated.",
  UNKNOWN_SCENE: "A selected Scene isn't in the video any more. Select the Scenes again.",
  UNKNOWN_PROJECT: "This Project was closed. Go back to Home and open it again.",
};

function reviseErrorMessage(error: unknown) {
  if (!(error instanceof ORPCError) || !error.defined) {
    return "Something went wrong talking to the MotionBrief core. Try again.";
  }

  return REVISE_ERRORS[error.code] ?? `Couldn't start the Revision: ${error.message}`;
}
