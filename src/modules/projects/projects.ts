import { randomUUID } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { Format, NewProjectDefaults, Project, TranscriptionStatus, TranscriptWord } from "../../contract";
import type { Clock } from "../system";
import type { Media } from "../media";
import type { Transcriber } from "../transcriber";
import { createLastUsed } from "./defaults";
import { LOCK_FILE, readDocument, saveDocument, SCHEMA_VERSION, writeLock, type DocumentError, type ProjectDocument } from "./document";
import { copyHashed, fileStep, renameRetrying, type FileError, type Result } from "./files";
import { candidateName, nameFromFile, validName } from "./names";
import { createStatusStore } from "./status";

export type ProjectsOptions = {
  /** Where new Projects go by default: Documents/MotionBrief. */
  projectsDir: string;
  appDataDir: string;
  media: Media;
  transcriber: Transcriber;
  clock: Clock;
};

export type Projects = ReturnType<typeof createProjects>;

export type ProjectsError =
  | DocumentError
  | { code: "VOICEOVER_UNREADABLE"; path: string; detail: string }
  | { code: "NO_AUDIO"; path: string }
  | { code: "INVALID_NAME"; name: string }
  | { code: "NAME_TAKEN"; name: string }
  | { code: "UNKNOWN_PROJECT"; projectId: string }
  | { code: "TRANSCRIPT_NOT_READY"; projectId: string }
  | { code: "UNKNOWN_WORD"; index: number; words: number }
  | { code: "INVALID_WORD"; text: string };

export type NewProject = {
  voiceoverPath: string;
  name?: string;
  format?: Format;
  stylePreset?: string;
  language?: string;
  folder?: string;
};

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

type TranscriptionStore = ReturnType<typeof createStatusStore<TranscriptionStatus>>;

type OpenProject = {
  dir: string;
  document: ProjectDocument;
  transcription: TranscriptionStore;
  /** Aborts the running transcription. */
  job?: AbortController;
  /** Every change to the folder runs after the one before, so writes and renames never interleave. */
  queue: Promise<unknown>;
};

/**
 * The Project store: a Project is a plain folder named after it, holding `project.json`, a copy of its Voiceover and,
 * while it is open, a `.lock` (ADR 0004). Open Projects transcribe their Voiceover as soon as they have one.
 */
export function createProjects({ projectsDir, appDataDir, media, transcriber, clock }: ProjectsOptions) {
  const open = new Map<string, OpenProject>();
  const lastUsed = createLastUsed(appDataDir);

  async function defaults(): Promise<NewProjectDefaults> {
    return { ...(await lastUsed.get()), folder: projectsDir };
  }

  async function create(input: NewProject): Promise<Result<Project, ProjectsError>> {
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

    return { data: toProject(register(dir, document)), error: null };
  }

  /** Opens a Project folder. One already open in this app is answered as it is. */
  async function openFolder(path: string): Promise<Result<Project, ProjectsError>> {
    const { data: document, error } = await readDocument(path);

    if (error) {
      return { data: null, error };
    }

    const already = open.get(document.id);

    if (already) {
      return { data: toProject(already), error: null };
    }

    const { error: lockError } = await writeLock(path);

    if (lockError) {
      return { data: null, error: lockError };
    }

    return { data: toProject(register(path, document)), error: null };
  }

  /** Keeps a locked Project open, transcribing its Voiceover unless its Transcript is saved. */
  function register(dir: string, document: ProjectDocument) {
    const project: OpenProject = {
      dir,
      document,
      transcription: createStatusStore<TranscriptionStatus>(initialStatus(document)),
      queue: Promise.resolve(),
    };
    open.set(document.id, project);

    if (!document.transcript) {
      startTranscription(project);
    }

    return project;
  }

  /** Makes the Project folder, numbering the name while a folder of that name exists. */
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

  async function update(projectId: string, changes: ProjectChanges): Promise<Result<Project, ProjectsError>> {
    const project = open.get(projectId);

    if (!project) {
      return { data: null, error: { code: "UNKNOWN_PROJECT", projectId } };
    }

    if (changes.name !== undefined) {
      const { error } = await rename(project, changes.name);

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

  /** Renames the Project, which renames its folder. */
  async function rename(project: OpenProject, requested: string): Promise<Result<null, ProjectsError>> {
    const name = validName(requested);

    if (!name) {
      return { data: null, error: { code: "INVALID_NAME", name: requested } };
    }

    if (name === basename(project.dir)) {
      return { data: null, error: null };
    }

    const target = join(dirname(project.dir), name);
    const isCaseChange = target.toLowerCase() === project.dir.toLowerCase();
    const { data: existing } = await fileStep(target, () => stat(target));

    if (existing && !isCaseChange) {
      return { data: null, error: { code: "NAME_TAKEN", name } };
    }

    return enqueue(project, async () => {
      const { error } = await fileStep(target, () => renameRetrying(project.dir, target));

      if (error) {
        return { data: null, error };
      }

      project.dir = target;

      return { data: null, error: null };
    });
  }

  /** Saves a change to the document once every earlier change to the folder is done, so none is lost. */
  function save(project: OpenProject, change: (document: ProjectDocument) => ProjectDocument) {
    return enqueue(project, async () => {
      const document = change(project.document);
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
      const document = { ...project.document, transcript: { ...transcript, words: transcript.words.with(index, fixed) } };
      const { error } = await saveDocument(project.dir, document);

      if (error) {
        return { data: null, error };
      }

      project.document = document;
      project.transcription.set(initialStatus(document));

      return { data: fixed, error: null };
    });
  }

  /** Stops the Project's work, waits for its last write, and releases the lock. */
  async function close(projectId: string) {
    const project = open.get(projectId);

    if (!project) {
      return;
    }

    open.delete(projectId);
    project.job?.abort();
    await enqueue(project, () => fileStep(project.dir, () => rm(join(project.dir, LOCK_FILE), { force: true })));
  }

  return { defaults, create, open: openFolder, update, watchTranscription, retryTranscription, fixWord, close };
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
