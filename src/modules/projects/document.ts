import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { FormatSchema, LanguageSchema, StylePresetIdSchema, TranscriptSchema } from "../../contract";
import { fileStep, writeAtomically, type FileError, type Result } from "./files";

/** The Project document's schema version; a newer app migrates older documents forward (ADR 0004). */
export const SCHEMA_VERSION = 1;

export const PROJECT_FILE = "project.json";

export const LOCK_FILE = ".lock";

/** `project.json`: everything about a Project that isn't a video. Paths are relative to the Project folder. */
export const ProjectDocumentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  createdAt: z.iso.datetime(),
  voiceover: z.object({
    /** The copy inside the Project folder. */
    file: z.string(),
    /** The name of the file the creator added. */
    fileName: z.string(),
    sha256: z.string(),
    bytes: z.number().int().nonnegative(),
    duration: z.number().nonnegative(),
    isVideo: z.boolean(),
  }),
  /** The Format and Style Preset its first video is generated in. */
  format: FormatSchema,
  stylePreset: StylePresetIdSchema,
  /** The language chosen for the Transcript, or `auto`. */
  language: LanguageSchema,
  /** Project-level and not versioned; `null` until transcription finishes. */
  transcript: TranscriptSchema.nullable(),
});

export type ProjectDocument = z.infer<typeof ProjectDocumentSchema>;

export function saveDocument(dir: string, document: ProjectDocument): Promise<Result<void, FileError>> {
  return writeAtomically(join(dir, PROJECT_FILE), `${JSON.stringify(document, null, 2)}\n`);
}

export type DocumentError = FileError | { code: "INVALID_DOCUMENT"; path: string; message: string };

export async function readDocument(dir: string): Promise<Result<ProjectDocument, DocumentError>> {
  const path = join(dir, PROJECT_FILE);
  const { data: text, error } = await fileStep(path, () => readFile(path, "utf8"));

  if (error) {
    return { data: null, error };
  }

  const { success, data: document, error: parseError } = ProjectDocumentSchema.safeParse(parseJson(text));

  if (!success) {
    return { data: null, error: { code: "INVALID_DOCUMENT", path, message: parseError.message } };
  }

  return { data: document, error: null };
}

/** Marks the Project as open in this app, so another app or computer can tell (ADR 0004). */
export function writeLock(dir: string) {
  return writeAtomically(join(dir, LOCK_FILE), JSON.stringify({ host: hostname(), pid: process.pid }));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
