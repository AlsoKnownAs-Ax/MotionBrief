import { randomUUID } from "node:crypto";
import type { ChatEntry, ChatRequestState, ChatStatus, RevisionRequest, RevisionStatus, VersionSummary, VideoRef } from "../../contract";
import type { Generation } from "../generation";
import { createStatusStore, type ChatLine, type Projects, type ProjectsError, type VersionError } from "../projects";
import type { Revisions } from "../revision";
import type { Clock } from "../system";

export type HistoryOptions = {
  projects: Projects;
  revisions: Pick<Revisions, "start" | "isRunning" | "whenEnded">;
  generation: Pick<Generation, "isRunning" | "whenEnded">;
  clock: Clock;
};

export type HistoryError =
  | Extract<ProjectsError, { code: "UNKNOWN_PROJECT" | "FILE_FAILED" }>
  | { code: "INVALID_VERSION"; path: string; message: string }
  | { code: "UNKNOWN_VERSION"; version: number }
  | { code: "BUSY"; projectId: string };

type Result<T, E> = { data: T; error: null } | { data: null; error: E };

export type History = ReturnType<typeof createHistory>;

type StatusStore = ReturnType<typeof createStatusStore<ChatStatus>>;

/** A video's chat while its Project is open: the log as it adds up, and the request it is running. */
type VideoChat = {
  store: StatusStore;
  /** The request whose Revision is running. */
  running?: string;
  /** The last queue step or Restore; each runs after the one before. */
  step: Promise<unknown>;
};

/** How a Revision's last status ends the request that started it. */
const ENDINGS = {
  answered: "answered",
  done: "done",
  failed: "failed",
  stopped: "stopped",
} satisfies Partial<Record<RevisionStatus["state"], ChatRequestState>>;

/**
 * A video's history: its Versions, Restore, and its chat. Requests sent in chat run as Revisions one at a time; while
 * the video is busy (a first generation, a Retry or a Revision) they queue, and run in order once it is idle. The
 * chat, with how each request ended, is kept with the video as an append-only log. A queue left behind by a quit or
 * crash reopens paused, and so does one behind a stopped Revision: only Resume queue runs it, so nothing is spent on
 * its own.
 */
export function createHistory({ projects, revisions, generation, clock }: HistoryOptions) {
  const videos = new Map<string, Promise<Result<VideoChat, HistoryError>>>();

  // A closed Project's chat is read again from its log when it next opens, so its queue reopens paused.
  projects.whenClosing(async (projectId) => {
    [...videos.keys()].filter((key) => key.startsWith(`${projectId} `)).forEach((key) => videos.delete(key));
  });

  revisions.whenEnded((ref, status) => void revisionEnded(ref, status));
  generation.whenEnded((ref) => void next(ref));

  function keyOf({ projectId, format }: VideoRef) {
    return `${projectId} ${format}`;
  }

  /** The video's chat, read from its log on first use. Requests that were running then were discarded by a quit. */
  function chatOf(ref: VideoRef): Promise<Result<VideoChat, HistoryError>> {
    const key = keyOf(ref);
    const loaded = videos.get(key) ?? load(ref);
    videos.set(key, loaded);
    void loaded.then(({ error }) => {
      if (error && videos.get(key) === loaded) {
        videos.delete(key);
      }
    });

    return loaded;
  }

  async function load(ref: VideoRef): Promise<Result<VideoChat, HistoryError>> {
    const { data: logged, error } = await projects.readChat(ref.projectId, ref.format);

    if (error) {
      return { data: null, error: historyError(error) };
    }

    const entries = logged.map(closedIfRunning);
    const store = createStatusStore<ChatStatus>({ entries, isPaused: hasQueued(entries) });

    return { data: { store, step: Promise.resolve() }, error: null };
  }

  /** Adds a line to the video's log, then to the chat it streams. */
  async function record(ref: VideoRef, { store }: VideoChat, line: ChatLine): Promise<Result<null, HistoryError>> {
    const { error } = await projects.appendChat(ref.projectId, ref.format, line);

    if (error) {
      return { data: null, error: historyError(error) };
    }

    store.update({ entries: merged(store.get().entries, line) });

    return { data: null, error: null };
  }

  /** Runs `step` after the video's queue step or Restore before it. */
  function inTurn<T>(chat: VideoChat, step: () => Promise<T>): Promise<T> {
    const done = chat.step.then(step);
    chat.step = done.catch(() => undefined);

    return done;
  }

  /** Sends a request: it runs now when the video is idle, else queues. Answers with its chat entry. */
  async function send(ref: VideoRef, { message, scope }: RevisionRequest): Promise<Result<ChatEntry, HistoryError>> {
    const { data: chat, error } = await chatOf(ref);

    if (error) {
      return { data: null, error };
    }

    const entry: ChatEntry = { id: randomUUID(), kind: "request", at: now(), message, scope, state: "queued" };
    const { error: recordError } = await record(ref, chat, entry);

    if (recordError) {
      return { data: null, error: recordError };
    }

    await next(ref);

    return { data: chat.store.get().entries.find(({ id }) => id === entry.id) ?? entry, error: null };
  }

  /** Starts the first queued request, unless the queue is paused or the video is busy. */
  async function next(ref: VideoRef) {
    const { data: chat } = await chatOf(ref);

    if (!chat) {
      return;
    }

    await inTurn(chat, () => startNext(ref, chat));
  }

  async function startNext(ref: VideoRef, chat: VideoChat): Promise<void> {
    const { entries, isPaused } = chat.store.get();
    const queued = entries.find(({ state }) => state === "queued");

    if (!queued || isPaused || isBusy(ref, chat)) {
      return;
    }

    chat.running = queued.id;
    const { error: recordError } = await record(ref, chat, { id: queued.id, state: "running" });

    if (recordError) {
      chat.running = undefined;
      return;
    }

    const { error } = await revisions.start(ref, { message: queued.message ?? "", scope: queued.scope ?? [] });

    if (!error) {
      return;
    }

    chat.running = undefined;

    // A Revision started outside the chat got there first: wait for it to end.
    if (error.code === "REVISING") {
      await record(ref, chat, { id: queued.id, state: "queued" });
      return;
    }

    await record(ref, chat, { id: queued.id, state: "refused", refused: error.code });
    await startNext(ref, chat);
  }

  /** Records how the running request's Revision ended, then runs what queued behind it; a Stop pauses the queue. */
  async function revisionEnded(ref: VideoRef, status: RevisionStatus) {
    const loaded = videos.get(keyOf(ref));
    const { data: chat } = (await loaded) ?? {};

    if (!chat) {
      return;
    }

    const id = chat.running;
    chat.running = undefined;

    if (id) {
      const { reply, summary, notApplied, version, error } = status;
      await record(ref, chat, { id, state: endingOf(status.state), reply, summary, notApplied, version, error });
    }

    if (status.state === "stopped" && hasQueued(chat.store.get().entries)) {
      chat.store.update({ isPaused: true });
    }

    await next(ref);
  }

  /** Runs the paused queue. */
  async function resume(ref: VideoRef): Promise<Result<null, HistoryError>> {
    const { data: chat, error } = await chatOf(ref);

    if (error) {
      return { data: null, error };
    }

    chat.store.update({ isPaused: false });
    await next(ref);

    return { data: null, error: null };
  }

  function isBusy(ref: VideoRef, chat: VideoChat) {
    return chat.running !== undefined || revisions.isRunning(ref) || generation.isRunning(ref);
  }

  /** Streams the video's chat. */
  async function watch(ref: VideoRef, signal?: AbortSignal): Promise<Result<AsyncGenerator<ChatStatus>, HistoryError>> {
    const { data: chat, error } = await chatOf(ref);

    if (error) {
      return { data: null, error };
    }

    return { data: chat.store.watch(signal), error: null };
  }

  /** The video's Versions, newest first. */
  async function versions(ref: VideoRef): Promise<Result<VersionSummary[], HistoryError>> {
    const { data: listed, error } = await projects.versions(ref.projectId, ref.format);

    if (error) {
      return { data: null, error: historyError(error) };
    }

    return { data: listed, error: null };
  }

  /**
   * Restores an earlier Version as a new one on top. Refused while the video is busy, since a run going on would
   * save its own Version over it; in turn with the queue, so none starts meanwhile.
   */
  async function restore(ref: VideoRef, number: number): Promise<Result<{ version: number }, HistoryError>> {
    const { data: chat, error } = await chatOf(ref);

    if (error) {
      return { data: null, error };
    }

    return inTurn(chat, () => restoreInTurn(ref, chat, number));
  }

  async function restoreInTurn(ref: VideoRef, chat: VideoChat, number: number): Promise<Result<{ version: number }, HistoryError>> {
    if (isBusy(ref, chat)) {
      return { data: null, error: { code: "BUSY", projectId: ref.projectId } };
    }

    const { data: listed, error } = await versions(ref);

    if (error) {
      return { data: null, error };
    }

    if (!listed.some(({ version }) => version === number)) {
      return { data: null, error: { code: "UNKNOWN_VERSION", version: number } };
    }

    const { data: version, error: restoreError } = await projects.restoreVersion(ref.projectId, ref.format, number);

    if (restoreError) {
      return { data: null, error: historyError(restoreError) };
    }

    const { error: recordError } = await record(ref, chat, { id: randomUUID(), kind: "restore", at: now(), restoredFrom: number, version });

    if (recordError) {
      return { data: null, error: recordError };
    }

    return { data: { version }, error: null };
  }

  function now() {
    return new Date(clock.now()).toISOString();
  }

  return { send, resume, watch, versions, restore };
}

function hasQueued(entries: ChatEntry[]) {
  return entries.some(({ state }) => state === "queued");
}

/** A request the log says was running when the video was last open: the quit discarded its Revision. */
function closedIfRunning(entry: ChatEntry): ChatEntry {
  if (entry.state !== "running") {
    return entry;
  }

  return { ...entry, state: "closed" };
}

function merged(entries: ChatEntry[], line: ChatLine): ChatEntry[] {
  const index = entries.findIndex(({ id }) => id === line.id);

  if (index === -1) {
    return [...entries, line as ChatEntry];
  }

  return entries.with(index, { ...entries[index]!, ...line });
}

function endingOf(state: RevisionStatus["state"]): ChatRequestState {
  return ENDINGS[state as keyof typeof ENDINGS] ?? "failed";
}

function historyError(error: ProjectsError | VersionError): HistoryError {
  if (error.code === "UNKNOWN_PROJECT" || error.code === "FILE_FAILED") {
    return error;
  }

  if (error.code === "INVALID_DOCUMENT") {
    return { code: "INVALID_VERSION", path: error.path, message: error.message };
  }

  return { code: "FILE_FAILED", path: "", message: error.code };
}
