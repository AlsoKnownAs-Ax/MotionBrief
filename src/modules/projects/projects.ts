import { randomUUID } from "node:crypto";
import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import type {
  Format,
  NewProjectDefaults,
  OpenedProject,
  Project,
  ProjectSummary,
  Transcript,
  TranscriptionStatus,
  TranscriptWord,
  UnitCode,
} from "../../contract";
import type { Clock } from "../system";
import type { Media } from "../media";
import type { Transcriber } from "../transcriber";
import { createLastUsed } from "./defaults";
import { currentDocument, readAnyDocument, saveDocument, SCHEMA_VERSION, type AnyDocument, type DocumentError, type ProjectDocument } from "./document";
import { copyHashed, fileStep, renameRetrying, type FileError, type Result } from "./files";
import { LOCK_FILE, readLock, removeLock, writeLock, type Lock } from "./locks";
import { backUpDocuments, migrate } from "./migrations";
import { candidateName, nameFromFile, validName } from "./names";
import { folderKey, samePath } from "./paths";
import { createRecents } from "./recents";
import { createStatusStore } from "./status";
import { summarize } from "./summary";
import { readVideo, saveVideo, type VideoDocument, type VideoDocumentError } from "./video";
import { latestVersion, readVersion, saveGeneration, saveVersion, writeUnit, type GenerationRecord, type Version, type VersionError } from "./videos";

/** Moves a file or folder to the OS Trash or Recycle Bin; only main can, so the core asks it. */
export type Trash = (path: string) => Promise<void>;

export type ProjectsOptions = {
  /** Where new Projects go by default: Documents/MotionBrief. */
  projectsDir: string;
  appDataDir: string;
  /** Recorded in every Project it saves, so an older app can say which version to update to. */
  appVersion: string;
  media: Media;
  transcriber: Transcriber;
  clock: Clock;
  trash: Trash;
};

export type Projects = ReturnType<typeof createProjects>;

export type ProjectsError =
  | DocumentError
  | { code: "VOICEOVER_UNREADABLE"; path: string; detail: string }
  | { code: "NO_AUDIO"; path: string }
  | { code: "INVALID_NAME"; name: string }
  | { code: "NAME_TAKEN"; name: string }
  | { code: "UNKNOWN_PROJECT"; projectId: string }
  | { code: "PROJECT_TOO_NEW"; path: string; name: string; appVersion?: string }
  | { code: "PROJECT_LOCKED"; path: string; name: string; host: string; isThisComputer: boolean; isStale: boolean; lockedAt: number }
  | { code: "ALREADY_OPEN"; path: string }
  | { code: "TRANSCRIPT_NOT_READY"; projectId: string }
  | { code: "UNKNOWN_WORD"; index: number; words: number }
  | { code: "INVALID_WORD"; text: string };

/** The window asking, so each window has at most one open Project. Absent for callers that aren't windows. */
export type Caller = { connection?: string };

export type NewProject = {
  voiceoverPath: string;
  name?: string;
  format?: Format;
  stylePreset?: string;
  language?: string;
  folder?: string;
};

export type ProjectVideo = {
  project: Project;
  /** `null` until transcription finishes. */
  transcript: Transcript | null;
  voiceoverPath: string;
  /** The video's newest Version; absent until its first generation is saved. */
  version?: number;
};

export type FrameCheck = NonNullable<VideoDocument["frameChecked"]>;

/** A video's newest Version as saved, its units' Scene code by unit id, and the frame re-check it last passed. */
export type StoredVideo = { version: Version; code: Record<string, UnitCode>; frameChecked?: FrameCheck };

export type ProjectChanges = {
  name?: string;
  format?: Format;
  stylePreset?: string;
  language?: string;
};

/** A Voiceover longer than this is allowed, with a warning that generating it will be long and costly. */
const LONG_VOICEOVER_SECONDS = 20 * 60;

/** Enough tries to step past any number of same-named Projects a creator plausibly has. */
const MAX_NAME_ATTEMPTS = 1000;

/** Marks a folder Duplicate made: its first open gives it its own id, even if the original was never opened here. */
const DUPLICATE_FILE = ".duplicate";

type TranscriptionStore = ReturnType<typeof createStatusStore<TranscriptionStatus>>;

type OpenProject = {
  dir: string;
  /** The real folder behind `dir` (see `folderKey`): how the store tells whether a folder is this open Project. */
  key: string;
  document: ProjectDocument;
  transcription: TranscriptionStore;
  /** The window it is open in. */
  owner?: string;
  /** Aborts the running transcription. */
  job?: AbortController;
  /** Every change to the folder runs after the one before, so writes and renames never interleave. */
  queue: Promise<unknown>;
};

/**
 * The Project store: a Project is a plain folder named after it, holding `project.json`, a copy of its Voiceover and,
 * while it is open, a `.lock` (ADR 0004). Open Projects transcribe their Voiceover as soon as they have one. Recent
 * Projects are tracked by path in app data.
 */
export function createProjects({ projectsDir, appDataDir, appVersion, media, transcriber, clock, trash }: ProjectsOptions) {
  const open = new Map<string, OpenProject>();
  /** The last lifecycle step queued on each folder, by `folderKey`. */
  const lifecycle = new Map<string, Promise<unknown>>();
  const lastUsed = createLastUsed(appDataDir);
  const recents = createRecents(appDataDir);

  async function defaults(): Promise<NewProjectDefaults> {
    return { ...(await lastUsed.get()), folder: projectsDir };
  }

  async function create(input: NewProject, { connection }: Caller = {}): Promise<Result<Project, ProjectsError>> {
    const { voiceoverPath } = input;
    const { data: info, error } = await media.probe(voiceoverPath);

    if (error?.code === "NO_AUDIO") {
      return { data: null, error };
    }

    if (error) {
      return { data: null, error: { code: "VOICEOVER_UNREADABLE", path: voiceoverPath, detail: error.detail } };
    }

    const fileName = basename(voiceoverPath);
    const name = nameFor(input.name, fileName);

    if (!name) {
      return { data: null, error: { code: "INVALID_NAME", name: input.name ?? "" } };
    }

    const { data: dir, error: dirError } = await claimFolder(input.folder ?? projectsDir, name);

    if (dirError) {
      return { data: null, error: dirError };
    }

    const choices = { ...(await lastUsed.get()), ...definedOf({ format: input.format, stylePreset: input.stylePreset }) };
    const file = `voiceover${extname(fileName).toLowerCase()}`;
    const { data: sha256, error: copyError } = await copyHashed(voiceoverPath, join(dir, file));
    const { data: stats } = await fileStep(voiceoverPath, () => stat(voiceoverPath));

    if (copyError) {
      await fileStep(dir, () => rm(dir, { recursive: true, force: true }));

      return { data: null, error: copyError };
    }

    const document: ProjectDocument = {
      schemaVersion: SCHEMA_VERSION,
      appVersion,
      id: randomUUID(),
      createdAt: new Date(clock.now()).toISOString(),
      voiceover: { file, fileName, sha256, bytes: stats?.size ?? 0, duration: info.duration, isVideo: info.isVideo },
      ...choices,
      language: input.language ?? "auto",
      transcript: null,
    };
    const { error: saveError } = await firstError([() => saveDocument(dir, document), () => writeLock(dir)]);

    if (saveError) {
      await fileStep(dir, () => rm(dir, { recursive: true, force: true }));

      return { data: null, error: saveError };
    }

    await lastUsed.remember(choices);
    const project = await adopt(dir, await folderKey(dir), document, connection);
    startTranscription(project);

    return { data: toProject(project), error: null };
  }

  /** Makes a Project folder, numbering the name while a folder of that name exists. */
  async function claimFolder(folder: string, name: string, attempt = 1): Promise<Result<string, ProjectsError>> {
    const dir = join(folder, candidateName(name, attempt));
    const { error } = await fileStep(dir, async () => {
      await mkdir(folder, { recursive: true });
      await mkdir(dir);
    });

    if (!error) {
      return { data: dir, error: null };
    }

    if (!error.message.includes("EEXIST") || attempt >= MAX_NAME_ATTEMPTS) {
      return { data: null, error };
    }

    return claimFolder(folder, name, attempt + 1);
  }

  /**
   * Opens a Project folder for a window. Refuses a newer schema without touching anything, asks before taking a lock
   * held elsewhere, migrates an older schema after backing up its documents, and gives a copied folder its own id.
   */
  async function openFolder(path: string, { force = false } = {}, caller: Caller = {}): Promise<Result<OpenedProject, ProjectsError>> {
    const dir = resolve(path);
    const key = await folderKey(dir);

    return exclusive(key, () => openExclusively(dir, key, force, caller));
  }

  async function openExclusively(dir: string, key: string, force: boolean, { connection }: Caller): Promise<Result<OpenedProject, ProjectsError>> {
    const current = openAt(key);

    if (current && connection !== undefined && current.owner === connection) {
      return { data: { project: toProject(current) }, error: null };
    }

    if (current) {
      return { data: null, error: { code: "ALREADY_OPEN", path: dir } };
    }

    const { data: found, error } = await readAnyDocument(dir);

    if (error) {
      return { data: null, error };
    }

    if (found.schemaVersion > SCHEMA_VERSION) {
      return { data: null, error: { code: "PROJECT_TOO_NEW", path: dir, name: basename(dir), appVersion: found.appVersion } };
    }

    const lock = await readLock(dir);

    if (lock && !lock.isOurs && !force) {
      return { data: null, error: lockedError(dir, lock) };
    }

    const { error: lockError } = await writeLock(dir);

    if (lockError) {
      return { data: null, error: lockError };
    }

    const { data: loaded, error: loadError } = await load(dir, key, found);

    if (loadError) {
      await removeLock(dir);

      return { data: null, error: loadError };
    }

    const project = await adopt(dir, key, loaded.document, connection);

    if (!project.document.transcript) {
      startTranscription(project);
    }

    return { data: { project: toProject(project), backupPath: loaded.backupPath }, error: null };
  }

  /** The document brought up to this app's schema, under an id no other known Project folder owns. */
  async function load(dir: string, key: string, found: AnyDocument): Promise<Result<{ document: ProjectDocument; backupPath?: string }, ProjectsError>> {
    const { data: current, error } = await upToDate(dir, found);

    if (error) {
      return { data: null, error };
    }

    const marker = join(dir, DUPLICATE_FILE);
    const { data: isDuplicate } = await fileStep(marker, () => stat(marker));

    if (!isDuplicate && !(await isCopy(key, current.document.id))) {
      return { data: current, error: null };
    }

    const document = { ...current.document, id: randomUUID() };
    const { error: saveError } = await firstError([() => saveDocument(dir, document), () => fileStep(marker, () => rm(marker, { force: true }))]);

    if (saveError) {
      return { data: null, error: saveError };
    }

    return { data: { ...current, document }, error: null };
  }

  async function upToDate(dir: string, found: AnyDocument): Promise<Result<{ document: ProjectDocument; backupPath?: string }, ProjectsError>> {
    if (found.schemaVersion === SCHEMA_VERSION) {
      const { data: document, error } = currentDocument(dir, found);

      if (error) {
        return { data: null, error };
      }

      return { data: { document }, error: null };
    }

    const { data: document, error } = currentDocument(dir, migrate(found, appVersion));

    if (error) {
      return { data: null, error };
    }

    const { data: backupPath, error: backupError } = await backUpDocuments(dir, found.schemaVersion, clock.now());

    if (backupError) {
      return { data: null, error: backupError };
    }

    const { error: saveError } = await saveDocument(dir, document);

    if (saveError) {
      return { data: null, error: saveError };
    }

    return { data: { document, backupPath }, error: null };
  }

  /**
   * A folder is a copy when another folder this app knows still holds a Project with its id: one open now, or the
   * folder that last owned the id. A moved Project keeps its id, since its old folder is gone.
   */
  async function isCopy(key: string, id: string) {
    if ([...open.values()].some((project) => project.document.id === id && project.key !== key)) {
      return true;
    }

    const owner = (await recents.all()).find((recent) => recent.id === id);

    if (!owner || (await folderKey(owner.path)) === key) {
      return false;
    }

    const { data: document } = await readAnyDocument(owner.path);

    return document?.id === id;
  }

  /** Makes the Project the window's one open Project, closing any other it had. */
  async function adopt(dir: string, key: string, document: ProjectDocument, owner?: string) {
    if (owner !== undefined) {
      await Promise.all([...open.values()].filter((project) => project.owner === owner).map((project) => close(project.document.id)));
    }

    const project: OpenProject = {
      dir,
      key,
      document,
      owner,
      transcription: createStatusStore<TranscriptionStatus>(initialStatus(document)),
      queue: Promise.resolve(),
    };
    open.set(document.id, project);
    await recents.remember(dir, document.id);

    return project;
  }

  function openAt(key: string) {
    return [...open.values()].find((project) => project.key === key);
  }

  /**
   * Runs one lifecycle step on a folder at a time, so two windows can't both find it closed and both open, rename or
   * trash it. Keyed by the real folder, so another route to it waits too.
   */
  function exclusive<T>(key: string, step: () => Promise<T>): Promise<T> {
    const done = (lifecycle.get(key) ?? Promise.resolve()).then(step);
    const settled = done.catch(() => undefined);
    lifecycle.set(key, settled);
    void settled.then(() => {
      if (lifecycle.get(key) === settled) {
        lifecycle.delete(key);
      }
    });

    return done;
  }

  async function update(projectId: string, changes: ProjectChanges): Promise<Result<Project, ProjectsError>> {
    const project = open.get(projectId);

    if (!project) {
      return { data: null, error: { code: "UNKNOWN_PROJECT", projectId } };
    }

    if (changes.name !== undefined) {
      const { error } = await renameOpen(project, changes.name);

      if (error) {
        return { data: null, error };
      }
    }

    const choices = definedOf({ format: changes.format, stylePreset: changes.stylePreset, language: changes.language });
    const isNewLanguage = changes.language !== undefined && changes.language !== project.document.language;
    // A Transcript in another language is no use; it is replaced once the new one is done.
    const { error } = await save(project, (document) => ({ ...document, ...choices, transcript: keptTranscript(document, isNewLanguage) }));

    if (error) {
      return { data: null, error };
    }

    await lastUsed.remember(project.document);

    if (isNewLanguage) {
      startTranscription(project);
    }

    return { data: toProject(project), error: null };
  }

  /** Renames an open Project, which renames its folder. */
  async function renameOpen(project: OpenProject, requested: string): Promise<Result<null, ProjectsError>> {
    const { data: target, error } = await renameTarget(project.dir, requested);

    if (error) {
      return { data: null, error };
    }

    if (!target) {
      return { data: null, error: null };
    }

    return enqueue(project, async () => {
      const from = project.dir;
      const { error } = await fileStep(target, () => renameRetrying(from, target));

      if (error) {
        return { data: null, error };
      }

      project.dir = target;
      project.key = await folderKey(target);
      await recents.moved(from, target);

      return { data: null, error: null };
    });
  }

  /** The folder a Project renamed to `requested` moves to; undefined when the name is unchanged. */
  async function renameTarget(dir: string, requested: string): Promise<Result<string | undefined, ProjectsError>> {
    const name = validName(requested);

    if (!name) {
      return { data: null, error: { code: "INVALID_NAME", name: requested } };
    }

    if (name === basename(dir)) {
      return { data: undefined, error: null };
    }

    const target = join(dirname(dir), name);
    const { data: existing } = await fileStep(target, () => stat(target));

    if (existing && !samePath(target, dir)) {
      return { data: null, error: { code: "NAME_TAKEN", name } };
    }

    return { data: target, error: null };
  }

  /** Renames a closed Project from Home. */
  async function rename(path: string, requested: string, { force = false } = {}): Promise<Result<ProjectSummary, ProjectsError>> {
    const dir = resolve(path);
    const key = await folderKey(dir);

    return exclusive(key, () => renameExclusively(dir, key, requested, force));
  }

  async function renameExclusively(dir: string, key: string, requested: string, force: boolean): Promise<Result<ProjectSummary, ProjectsError>> {
    const { error } = await closedProject(dir, key, force);

    if (error) {
      return { data: null, error };
    }

    const { data: target, error: targetError } = await renameTarget(dir, requested);

    if (targetError) {
      return { data: null, error: targetError };
    }

    if (!target) {
      return summaryOf(dir);
    }

    const { error: renameError } = await fileStep(target, () => renameRetrying(dir, target));

    if (renameError) {
      return { data: null, error: renameError };
    }

    await recents.moved(dir, target);

    return summaryOf(target);
  }

  /**
   * Copies the Project's folder beside it as "<name> copy", marked as a duplicate: it keeps the id until it is first
   * opened, which gives it its own.
   */
  async function duplicate(path: string): Promise<Result<ProjectSummary, ProjectsError>> {
    const dir = resolve(path);

    return exclusive(await folderKey(dir), () => duplicateExclusively(dir));
  }

  async function duplicateExclusively(dir: string): Promise<Result<ProjectSummary, ProjectsError>> {
    const { error } = await readAnyDocument(dir);

    if (error) {
      return { data: null, error };
    }

    const { data: copy, error: copyError } = await claimFolder(dirname(dir), `${basename(dir)} copy`);

    if (copyError) {
      return { data: null, error: copyError };
    }

    const { error: cpError } = await fileStep(copy, async () => {
      await cp(dir, copy, { recursive: true, filter: (source) => isCopied(dir, source) });
      await writeFile(join(copy, DUPLICATE_FILE), "");
    });

    if (cpError) {
      await fileStep(copy, () => rm(copy, { recursive: true, force: true }));

      return { data: null, error: cpError };
    }

    await recents.remember(copy);

    return summaryOf(copy);
  }

  /** Moves a closed Project's folder to the Trash. Undo lives in the UI, which waits before asking. */
  async function remove(path: string, { force = false } = {}): Promise<Result<null, ProjectsError>> {
    const dir = resolve(path);
    const key = await folderKey(dir);

    return exclusive(key, () => removeExclusively(dir, key, force));
  }

  async function removeExclusively(dir: string, key: string, force: boolean): Promise<Result<null, ProjectsError>> {
    const { error } = await closedProject(dir, key, force);

    if (error) {
      return { data: null, error };
    }

    const { error: trashError } = await fileStep(dir, () => trash(dir));

    if (trashError) {
      return { data: null, error: trashError };
    }

    await recents.forget([dir]);

    return { data: null, error: null };
  }

  /**
   * A Project folder no window here has open. A lock left by anyone else, even a stale one, needs the creator's say-so
   * (`force`): the Project may be open on another computer that syncs the folder.
   */
  async function closedProject(dir: string, key: string, force: boolean): Promise<Result<AnyDocument, ProjectsError>> {
    if (openAt(key)) {
      return { data: null, error: { code: "ALREADY_OPEN", path: dir } };
    }

    const { data: document, error } = await readAnyDocument(dir);

    if (error) {
      return { data: null, error };
    }

    const lock = await readLock(dir);

    if (lock && !lock.isOurs && !force) {
      return { data: null, error: lockedError(dir, lock) };
    }

    return { data: document, error: null };
  }

  /** The recent Projects, newest change first. Forgets those whose folders are gone. */
  async function list(): Promise<ProjectSummary[]> {
    const remembered = (await recents.all()).map(({ path }) => path);
    const { data: entries } = await fileStep(projectsDir, () => readdir(projectsDir, { withFileTypes: true }));
    const inDefault = (entries ?? []).filter((entry) => entry.isDirectory()).map((entry) => join(projectsDir, entry.name));
    const paths = [...inDefault, ...remembered].filter((path, index, all) => all.findIndex((other) => samePath(other, path)) === index);
    const summaries = await Promise.all(paths.map((path) => summarize(path, projectsDir)));
    const gone = remembered.filter((path) => !summaries.some((summary) => summary && samePath(summary.path, path)));

    if (gone.length > 0) {
      await recents.forget(gone);
    }

    return summaries.filter((summary) => summary !== undefined).sort((a, b) => b.modifiedAt - a.modifiedAt);
  }

  async function summaryOf(dir: string): Promise<Result<ProjectSummary, ProjectsError>> {
    const summary = await summarize(dir, projectsDir);

    if (!summary) {
      return { data: null, error: { code: "NOT_A_PROJECT", path: dir, detail: "project.json is missing" } };
    }

    return { data: summary, error: null };
  }

  /** Saves a change to the document once every earlier change to the folder is done, so none is lost. */
  function save(project: OpenProject, change: (document: ProjectDocument) => ProjectDocument) {
    return enqueue(project, async () => {
      const document = { ...change(project.document), appVersion };
      const { error } = await saveDocument(project.dir, document);

      if (error) {
        return { data: null, error };
      }

      project.document = document;

      return { data: null, error: null };
    });
  }

  function enqueue<T>(project: OpenProject, step: () => Promise<T>): Promise<T> {
    const done = project.queue.then(step);
    project.queue = done.catch(() => undefined);

    return done;
  }

  /** Transcribes the Voiceover in the Project's language, replacing any transcription already running. */
  function startTranscription(project: OpenProject) {
    project.job?.abort();
    const job = new AbortController();
    project.job = job;
    const { document } = project;
    const { duration } = document.voiceover;
    project.transcription.set({ ...initialStatus(document), state: "transcribing" });

    void transcriber
      .transcribe({
        voiceoverPath: () => join(project.dir, document.voiceover.file),
        voiceoverSha256: document.voiceover.sha256,
        duration,
        language: document.language,
        signal: job.signal,
        onUpdate: (update) => {
          if (!job.signal.aborted) {
            project.transcription.set({ ...update, duration });
          }
        },
      })
      .then(async ({ data: transcript, error }) => {
        if (job.signal.aborted) {
          return;
        }

        if (error) {
          project.transcription.update({ state: "failed", error });
          return;
        }

        const { error: saveError } = await save(project, (saved) => ({ ...saved, transcript }));

        if (saveError) {
          project.transcription.update({ state: "failed", error: { code: "FILE_FAILED", message: `${saveError.path}: ${saveError.message}` } });
          return;
        }

        project.transcription.set(initialStatus(project.document));
      });
  }

  function watchTranscription(projectId: string, signal?: AbortSignal): Result<AsyncGenerator<TranscriptionStatus>, ProjectsError> {
    const project = open.get(projectId);

    if (!project) {
      return { data: null, error: { code: "UNKNOWN_PROJECT", projectId } };
    }

    return { data: project.transcription.watch(signal), error: null };
  }

  function retryTranscription(projectId: string): Result<null, ProjectsError> {
    const project = open.get(projectId);

    if (!project) {
      return { data: null, error: { code: "UNKNOWN_PROJECT", projectId } };
    }

    if (project.transcription.get().state === "failed") {
      startTranscription(project);
    }

    return { data: null, error: null };
  }

  /** What a video of an open Project is generated from: the Project, its Transcript once done, its Voiceover and its newest Version. */
  async function video(projectId: string, format: Format): Promise<Result<ProjectVideo, ProjectsError>> {
    const project = open.get(projectId);

    if (!project) {
      return { data: null, error: { code: "UNKNOWN_PROJECT", projectId } };
    }

    // Read once the folder's earlier changes are done, so a rename in progress has finished.
    return enqueue(project, async () => ({
      data: {
        project: toProject(project),
        transcript: project.document.transcript,
        voiceoverPath: join(project.dir, project.document.voiceover.file),
        version: await latestVersion(project.dir, format),
      },
      error: null,
    }));
  }

  /**
   * Fixes a misheard word in the saved Transcript: its text changes and its timing stays. The Transcript is
   * Project-level, so this never touches a video or its Versions.
   */
  async function fixWord(projectId: string, index: number, requested: string): Promise<Result<TranscriptWord, ProjectsError>> {
    const project = open.get(projectId);

    if (!project) {
      return { data: null, error: { code: "UNKNOWN_PROJECT", projectId } };
    }

    const text = requested.trim().replace(/\s+/g, " ");

    if (!text) {
      return { data: null, error: { code: "INVALID_WORD", text: requested } };
    }

    // Checked in the queue, against the Transcript every earlier change left.
    return enqueue(project, async (): Promise<Result<TranscriptWord, ProjectsError>> => {
      const { transcript } = project.document;

      if (!transcript) {
        return { data: null, error: { code: "TRANSCRIPT_NOT_READY", projectId } };
      }

      const word = transcript.words[index];

      if (!word) {
        return { data: null, error: { code: "UNKNOWN_WORD", index, words: transcript.words.length } };
      }

      const fixed = fixedWord(word, text);
      const document = { ...project.document, appVersion, transcript: { ...transcript, words: transcript.words.with(index, fixed) } };
      const { error } = await saveDocument(project.dir, document);

      if (error) {
        return { data: null, error };
      }

      project.document = document;
      project.transcription.set(initialStatus(document));

      return { data: fixed, error: null };
    });
  }

  /** Where the video was last exported to, kept in the video's folder; absent before its first export. */
  async function lastExportPath(projectId: string, format: Format): Promise<Result<string | undefined, ProjectsError | VideoDocumentError>> {
    const project = open.get(projectId);

    if (!project) {
      return { data: null, error: { code: "UNKNOWN_PROJECT", projectId } };
    }

    const { data: video, error } = await enqueue(project, () => readVideo(project.dir, format));

    if (error) {
      return { data: null, error };
    }

    return { data: video.lastExportPath, error: null };
  }

  function rememberExportPath(projectId: string, format: Format, path: string): Promise<Result<null, ProjectsError | VideoDocumentError>> {
    const project = open.get(projectId);

    if (!project) {
      return Promise.resolve({ data: null, error: { code: "UNKNOWN_PROJECT", projectId } });
    }

    return enqueue(project, async () => {
      const { data: video, error } = await readVideo(project.dir, format);

      if (error) {
        return { data: null, error };
      }

      const { error: saveError } = await saveVideo(project.dir, format, { ...video, lastExportPath: path });

      if (saveError) {
        return { data: null, error: saveError };
      }

      return { data: null, error: null };
    });
  }

  /** The video's newest Version with its units' Scene code, and the frame re-check it passed; absent before its first generation is saved. */
  async function storedVideo(projectId: string, format: Format): Promise<Result<StoredVideo | undefined, ProjectsError | VersionError>> {
    const project = open.get(projectId);

    if (!project) {
      return { data: null, error: { code: "UNKNOWN_PROJECT", projectId } };
    }

    return enqueue(project, async (): Promise<Result<StoredVideo | undefined, ProjectsError | VersionError>> => {
      const number = await latestVersion(project.dir, format);

      if (number === undefined) {
        return { data: undefined, error: null };
      }

      const [{ data: stored, error }, { data: video, error: videoError }] = await Promise.all([readVersion(project.dir, format, number), readVideo(project.dir, format)]);

      if (error) {
        return { data: null, error };
      }

      if (videoError) {
        return { data: null, error: videoError };
      }

      return { data: { ...stored, frameChecked: video.frameChecked }, error: null };
    });
  }

  /** Remembers that a Version's units pass a frame contract, so they aren't re-checked against it again. */
  function rememberFrameCheck(projectId: string, format: Format, frameChecked: FrameCheck): Promise<Result<null, ProjectsError | VideoDocumentError>> {
    const project = open.get(projectId);

    if (!project) {
      return Promise.resolve({ data: null, error: { code: "UNKNOWN_PROJECT", projectId } });
    }

    return enqueue(project, async () => {
      const { data: video, error } = await readVideo(project.dir, format);

      if (error) {
        return { data: null, error };
      }

      const { error: saveError } = await saveVideo(project.dir, format, { ...video, frameChecked });

      if (saveError) {
        return { data: null, error: saveError };
      }

      return { data: null, error: null };
    });
  }

  /** Runs a write in the Project folder after its earlier changes, wherever the folder is by then. */
  function write<T>(projectId: string, step: (dir: string) => Promise<Result<T, FileError>>): Promise<Result<T, ProjectsError>> {
    const project = open.get(projectId);

    if (!project) {
      return Promise.resolve({ data: null, error: { code: "UNKNOWN_PROJECT", projectId } });
    }

    return enqueue(project, () => step(project.dir));
  }

  /** Stops the Project's work, waits for its last write, and releases the lock. */
  async function close(projectId: string) {
    const project = open.get(projectId);

    if (!project) {
      return;
    }

    // Exclusive, so an open of the same folder waiting meanwhile can't take the lock and then lose it to this close.
    await exclusive(project.key, async () => {
      if (open.get(projectId) !== project) {
        return;
      }

      open.delete(projectId);
      project.job?.abort();
      await enqueue(project, () => removeLock(project.dir));
    });
  }

  /** Closes the Projects a window had open, once the window is gone. */
  async function disconnect(connection: string) {
    await Promise.all([...open.values()].filter(({ owner }) => owner === connection).map((project) => close(project.document.id)));
  }

  /** Closes every open Project, releasing its lock, before the app quits. */
  async function closeAll() {
    await Promise.all([...open.keys()].map(close));
  }

  return {
    list,
    open: openFolder,
    rename,
    duplicate,
    remove,
    defaults,
    create,
    update,
    watchTranscription,
    retryTranscription,
    fixWord,
    video,
    /** Stores a unit's Scene code in the video's content-addressed store; resolves to its hash. */
    writeUnit: (projectId: string, format: Format, code: UnitCode) => write(projectId, (dir) => writeUnit(dir, format, code)),
    /** Saves the first generation in progress, so its finished units outlive a crash. */
    saveGeneration: (projectId: string, format: Format, record: GenerationRecord) => write(projectId, (dir) => saveGeneration(dir, format, record)),
    /** Saves the video's next Version; resolves to its number. */
    saveVersion: (projectId: string, format: Format, version: Omit<Version, "version">) => write(projectId, (dir) => saveVersion(dir, format, version)),
    lastExportPath,
    rememberExportPath,
    storedVideo,
    rememberFrameCheck,
    close,
    disconnect,
    closeAll,
  };
}

function lockedError(dir: string, { host, isThisComputer, isStale, lockedAt }: Lock): ProjectsError {
  return { code: "PROJECT_LOCKED", path: dir, name: basename(dir), host, isThisComputer, isStale, lockedAt };
}

/** A duplicate leaves out the original's lock and any half-written file. */
function isCopied(dir: string, source: string) {
  return relative(dir, source) !== LOCK_FILE && !source.endsWith(".tmp");
}

/** The word with the creator's text, remembering what was heard; set back to that, it is as heard again. */
function fixedWord(word: TranscriptWord, text: string): TranscriptWord {
  const heard = word.heard ?? word.text;

  if (text === heard) {
    return { text, start: word.start, end: word.end };
  }

  return { text, start: word.start, end: word.end, heard };
}

function keptTranscript(document: ProjectDocument, isNewLanguage: boolean) {
  if (isNewLanguage) {
    return null;
  }

  return document.transcript;
}

/** A transcribed Project is done; any other is about to start. */
function initialStatus({ transcript, voiceover }: ProjectDocument): TranscriptionStatus {
  if (transcript) {
    return { state: "done", transcribedSeconds: transcript.duration, duration: transcript.duration, language: transcript.language, words: transcript.words };
  }

  return { state: "waiting-for-model", transcribedSeconds: 0, duration: voiceover.duration, words: [] };
}

function toProject({ dir, document }: OpenProject): Project {
  const { voiceover } = document;

  return {
    id: document.id,
    name: basename(dir),
    path: dir,
    format: document.format,
    stylePreset: document.stylePreset,
    language: document.language,
    voiceover: {
      fileName: voiceover.fileName,
      bytes: voiceover.bytes,
      duration: voiceover.duration,
      isVideo: voiceover.isVideo,
      isLong: voiceover.duration > LONG_VOICEOVER_SECONDS,
    },
  };
}

/** The requested name if it can be a folder name; without one, the Voiceover's file name. */
function nameFor(requested: string | undefined, fileName: string) {
  if (requested === undefined) {
    return nameFromFile(basename(fileName, extname(fileName)));
  }

  return validName(requested);
}

/** The fields that were given, so they can be spread over defaults. */
function definedOf<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>;
}

/** Runs steps in order, stopping at the first error. */
async function firstError(steps: (() => Promise<Result<unknown, FileError>>)[]): Promise<Result<null, FileError>> {
  for (const step of steps) {
    const { error } = await step();

    if (error) {
      return { data: null, error };
    }
  }

  return { data: null, error: null };
}
