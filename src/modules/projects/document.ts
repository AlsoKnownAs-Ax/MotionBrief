import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { FormatSchema, LanguageSchema, StylePresetIdSchema, TranscriptSchema } from "../../contract";
import { fileStep, writeAtomically, type FileError, type Result } from "./files";

/**
 * The Project document's schema version; a newer app migrates older documents forward (ADR 0004).
 * 2: records the version of the app that last saved it.
 */
export const SCHEMA_VERSION = 2;

export const PROJECT_FILE = "project.json";

/** `project.json`: everything about a Project that isn't a video. Paths are relative to the Project folder. */
export const ProjectDocumentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  /** The MotionBrief version that last saved it, so an older app can say which version to update to. */
  appVersion: z.string(),
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

/**
 * What every schema version, past or future, is assumed to keep: enough to tell which version wrote it, to list it on
 * Home, and to tell a Project from any other folder with a project.json before renaming or trashing it.
 */
const AnyDocumentSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    id: z.string().min(1),
    createdAt: z.string(),
    appVersion: z.string().optional(),
    format: FormatSchema.optional().catch(undefined),
    voiceover: z.object({ duration: z.number().nonnegative().optional().catch(undefined) }).loose(),
  })
  .loose();

/** A document of any schema version, as read before it is migrated or refused. */
export type AnyDocument = z.infer<typeof AnyDocumentSchema>;

export type DocumentError = FileError | { code: "NOT_A_PROJECT"; path: string; detail: string };

export function saveDocument(dir: string, document: ProjectDocument): Promise<Result<void, FileError>> {
  return writeAtomically(join(dir, PROJECT_FILE), `${JSON.stringify(document, null, 2)}\n`);
}

/** Reads `project.json` without holding it to the current schema. */
export async function readAnyDocument(dir: string): Promise<Result<AnyDocument, DocumentError>> {
  const path = join(dir, PROJECT_FILE);
  const { data: text, error } = await fileStep(path, () => readFile(path, "utf8"));

  if (error?.message.includes("ENOENT") || error?.message.includes("ENOTDIR")) {
    return { data: null, error: { code: "NOT_A_PROJECT", path: dir, detail: `${PROJECT_FILE} is missing` } };
  }

  if (error) {
    return { data: null, error };
  }

  const { success, data: document } = AnyDocumentSchema.safeParse(parseJson(text));

  if (!success) {
    return { data: null, error: { code: "NOT_A_PROJECT", path: dir, detail: `${PROJECT_FILE} isn't a Project document` } };
  }

  return { data: document, error: null };
}

/** Holds a migrated document to the current schema. */
export function currentDocument(dir: string, document: AnyDocument): Result<ProjectDocument, DocumentError> {
  const { success, data, error } = ProjectDocumentSchema.safeParse(document);

  if (!success) {
    return { data: null, error: { code: "NOT_A_PROJECT", path: dir, detail: error.message } };
  }

  return { data, error: null };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
