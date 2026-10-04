import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { StylePresetSchema, UnitCodeSchema, type Format, type UnitCode } from "../../contract";
import { fileStep, writeAtomically, type FileError, type Result } from "./files";

/**
 * A video's files, in the Project folder's subfolder named after its Format (ADR 0004): Version
 * manifests in `versions/<n>.json`, the Scene code of their units in `units/<sha256>.json`, shared
 * by every Version that has the same code, and `generation.json` while a first generation runs.
 */
const UNITS_DIR = "units";
const VERSIONS_DIR = "versions";
const GENERATION_FILE = "generation.json";

/** A unit that plays something other than its own Scene code, and why. */
export const FlagSchema = z.object({
  unit: z.string(),
  /** Its code kept failing the checks, so it plays as its fallback Scene. */
  kind: z.literal("fallback"),
  /** The last findings, for the creator. */
  reason: z.string(),
});

/** What a video plays and how it was made: everything a Version holds besides its number. */
const VideoContentSchema = z.object({
  /** The Storyboard, as validated when it was written. */
  storyboard: z.unknown(),
  /** The Style Preset snapshot the video is drawn in. */
  preset: StylePresetSchema,
  captions: z.boolean(),
  /** The SHA-256 of each unit's Scene code in `units/`, by unit id. A unit without code plays as its fallback Scene. */
  units: z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/)),
  flags: z.array(FlagSchema),
  /** The model each agent role ran on. */
  models: z.record(z.string(), z.string()),
  /** The frame contract the units were written against. */
  frameContractVersion: z.string(),
});

/** What the creator asked of a Revision and what it did; the next Revision's agent reads these as the video's history. */
export const RevisionRecordSchema = z.object({
  request: z.string(),
  /** The Scenes the request was scoped to; none for the whole video. */
  scope: z.array(z.string()),
  /** The agent's one-line summary of its change. */
  summary: z.string(),
  /** Scenes whose instruction couldn't be applied, so they kept their previous code. */
  notApplied: z.array(z.string()),
});

export const VersionSchema = VideoContentSchema.extend({
  /** Counted from 1, in the order Versions were made. */
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  /** What made it: a first generation or a Revision. */
  origin: z.enum(["generation", "revision"]),
  /** Set on a Version a Revision made. */
  revision: RevisionRecordSchema.optional(),
});

/** A first generation in progress: its units are added as they finish, so a crash loses none of them. */
export const GenerationRecordSchema = VideoContentSchema.extend({ startedAt: z.iso.datetime() });

export type Flag = z.infer<typeof FlagSchema>;
export type VideoContent = z.infer<typeof VideoContentSchema>;
export type Version = z.infer<typeof VersionSchema>;
export type RevisionRecord = z.infer<typeof RevisionRecordSchema>;
export type GenerationRecord = z.infer<typeof GenerationRecordSchema>;

/** Stores a unit's Scene code under the hash of its file, once: Versions with the same code share it. */
export async function writeUnit(dir: string, format: Format, code: UnitCode): Promise<Result<string, FileError>> {
  const text = `${JSON.stringify(UnitCodeSchema.parse(code), null, 2)}\n`;
  const hash = createHash("sha256").update(text).digest("hex");
  const path = join(dir, format, UNITS_DIR, `${hash}.json`);
  const { data: existing } = await fileStep(path, () => stat(path));

  if (existing) {
    return { data: hash, error: null };
  }

  const { error } = await fileStep(path, () => mkdir(join(dir, format, UNITS_DIR), { recursive: true }));

  if (error) {
    return { data: null, error };
  }

  const { error: writeError } = await writeAtomically(path, text);

  if (writeError) {
    return { data: null, error: writeError };
  }

  return { data: hash, error: null };
}

export async function saveGeneration(dir: string, format: Format, record: GenerationRecord): Promise<Result<null, FileError>> {
  const path = join(dir, format, GENERATION_FILE);
  const { error } = await fileStep(path, () => mkdir(join(dir, format), { recursive: true }));

  if (error) {
    return { data: null, error };
  }

  const { error: writeError } = await writeAtomically(path, json(GenerationRecordSchema.parse(record)));

  if (writeError) {
    return { data: null, error: writeError };
  }

  return { data: null, error: null };
}

/** Saves the next Version of the video, which ends any generation in progress. */
export async function saveVersion(dir: string, format: Format, version: Omit<Version, "version">): Promise<Result<number, FileError>> {
  const number = ((await latestVersion(dir, format)) ?? 0) + 1;
  const path = join(dir, format, VERSIONS_DIR, `${number}.json`);
  const { error } = await fileStep(path, () => mkdir(join(dir, format, VERSIONS_DIR), { recursive: true }));

  if (error) {
    return { data: null, error };
  }

  const { error: writeError } = await writeAtomically(path, json(VersionSchema.parse({ ...version, version: number })));

  if (writeError) {
    return { data: null, error: writeError };
  }

  const generation = join(dir, format, GENERATION_FILE);
  const { error: cleanError } = await fileStep(generation, () => rm(generation, { force: true }));

  if (cleanError) {
    return { data: null, error: cleanError };
  }

  return { data: number, error: null };
}

/** The number of the video's newest Version; none before its first generation is saved. */
export async function latestVersion(dir: string, format: Format): Promise<number | undefined> {
  const names = await readdir(join(dir, format, VERSIONS_DIR)).catch(() => []);
  const numbers = names.map((name) => /^(\d+)\.json$/.exec(name)?.[1]).filter((number) => number !== undefined).map(Number);

  if (numbers.length === 0) {
    return undefined;
  }

  return Math.max(...numbers);
}

/** A saved Version of the video. */
export async function readVersion(dir: string, format: Format, number: number): Promise<Result<Version, FileError>> {
  const path = join(dir, format, VERSIONS_DIR, `${number}.json`);

  return readJson(path, VersionSchema);
}

/** A unit's Scene code by the hash a Version names it by. */
export async function readUnit(dir: string, format: Format, hash: string): Promise<Result<UnitCode, FileError>> {
  return readJson(join(dir, format, UNITS_DIR, `${hash}.json`), UnitCodeSchema);
}

async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<Result<T, FileError>> {
  const { data: found, error } = await fileStep(path, async () => JSON.parse(await readFile(path, "utf8")) as unknown);

  if (error) {
    return { data: null, error };
  }

  const parsed = schema.safeParse(found);

  if (!parsed.success) {
    return { data: null, error: { code: "FILE_FAILED", path, message: parsed.error.message } };
  }

  return { data: parsed.data, error: null };
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
