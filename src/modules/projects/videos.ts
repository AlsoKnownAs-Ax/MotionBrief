import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { StylePresetSchema, UnitCodeSchema, VersionOriginSchema, type Format, type UnitCode, type VersionSummary } from "../../contract";
import { fileStep, writeAtomically, type FileError, type Result } from "./files";

/**
 * A video's files, in the Project folder's subfolder named after its Format (ADR 0004): Version
 * manifests in `versions/<n>.json`, the Scene code of their units in `units/<sha256>.json`, shared
 * by every Version that has the same code, and `generation.json` while a first generation or Retry runs.
 */
const UNITS_DIR = "units";
const VERSIONS_DIR = "versions";
const GENERATION_FILE = "generation.json";

/** A unit the creator should look at, and why. */
export const FlagSchema = z.object({
  unit: z.string(),
  /**
   * `fallback`: its code kept failing the checks, so it plays as its fallback Scene. `review-note`: it plays
   * its code, but its visual review's repair was reverted, so the reviewer's complaint stands.
   */
  kind: z.enum(["fallback", "review-note"]),
  /** The last findings, or the reviewer's sentence, for the creator. */
  reason: z.string(),
});

/** What a video plays and how it was made: everything a Version holds besides its number. */
const VideoContentSchema = z.object({
  /** The Storyboard, as validated when it was written. */
  storyboard: z.unknown(),
  /** The Style Preset snapshot the video is drawn in. */
  preset: StylePresetSchema,
  /** Whether the Storyboard is written for Captions: the rules it is checked by. */
  captions: z.boolean(),
  /**
   * Whether the video shows Captions, once a style change or a Revision saved it; absent, they show as the Storyboard
   * is written. The Version alone decides, so a restored one plays with the Captions it had.
   */
  showsCaptions: z.boolean().optional(),
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
  origin: VersionOriginSchema,
  /** Set on a Version a Revision made. */
  revision: RevisionRecordSchema.optional(),
  /** Set on a Version a Restore made: the Version it is a copy of. */
  restoredFrom: z.number().int().positive().optional(),
  /** Set on a Version a style change made: what it changed, such as "Palette: Ember" or "Restyled to Whiteboard". */
  style: z.string().optional(),
  /** The run that saved it, so its record, left behind by a crash just after, is never saved again. */
  runId: z.string().optional(),
});

/**
 * A first generation or Retry in progress: its finished units are added as they pass, so a crash loses none of
 * them. A Retry only records one once a unit passes.
 */
export const GenerationRecordSchema = VideoContentSchema.extend({
  runId: z.string(),
  origin: VersionSchema.shape.origin,
  startedAt: z.iso.datetime(),
  /** Every unit the Storyboard plans, in its order: those neither stored nor flagged weren't finished. */
  planned: z.array(z.string()),
});

/** Why a unit of a run the app quit or crashed during plays as its fallback Scene. */
const RECOVERED_REASON = "MotionBrief closed before this Scene was finished.";

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

/**
 * Ends a run the app quit or crashed during by Stop's rules: its finished units are kept, the rest become flagged
 * fallbacks, and the whole is saved as the next Version. A run whose Version was saved before the crash is only
 * cleaned up. Resolves to the new Version's number; none without one.
 */
export async function recoverGeneration(dir: string, format: Format, createdAt: string): Promise<Result<number | undefined, FileError>> {
  const path = join(dir, format, GENERATION_FILE);
  const { data: text } = await fileStep(path, () => readFile(path, "utf8"));

  // Without a readable record there is nothing to keep; the next run overwrites it.
  if (text === null) {
    return { data: undefined, error: null };
  }

  const { success, data: record } = GenerationRecordSchema.safeParse(parseJson(text));

  if (!success) {
    return { data: undefined, error: null };
  }

  if ((await latestRunId(dir, format)) === record.runId) {
    const { error } = await fileStep(path, () => rm(path, { force: true }));

    if (error) {
      return { data: null, error };
    }

    return { data: undefined, error: null };
  }

  const { planned, runId, origin } = record;
  const content = VideoContentSchema.parse(record);
  const order = (unit: string) => planned.indexOf(unit);
  const flags = [
    ...content.flags,
    ...planned
      .filter((unit) => !content.units[unit])
      .filter((unit) => !content.flags.some((flag) => flag.unit === unit))
      .map((unit) => ({ unit, kind: "fallback" as const, reason: RECOVERED_REASON })),
  ].sort((a, b) => order(a.unit) - order(b.unit));

  return saveVersion(dir, format, { ...content, flags, origin, runId, createdAt });
}

/** The run that saved the video's newest Version, if it says. */
async function latestRunId(dir: string, format: Format): Promise<string | undefined> {
  const number = await latestVersion(dir, format);

  if (number === undefined) {
    return undefined;
  }

  const { data: version } = await readDocument(join(dir, format, VERSIONS_DIR, `${number}.json`), VersionSchema);

  return version?.runId;
}

export type VersionError = FileError | { code: "INVALID_DOCUMENT"; path: string; message: string };

export type StoredVersion = { version: Version; code: Record<string, UnitCode> };

/** A saved Version with its units' Scene code, by unit id. */
export async function readVersion(dir: string, format: Format, number: number): Promise<Result<StoredVersion, VersionError>> {
  const path = join(dir, format, VERSIONS_DIR, `${number}.json`);
  const { data: version, error } = await readDocument(path, VersionSchema);

  if (error) {
    return { data: null, error };
  }

  const code: Record<string, UnitCode> = {};

  for (const [unit, hash] of Object.entries(version.units)) {
    const { data: unitCode, error: unitError } = await readDocument(join(dir, format, UNITS_DIR, `${hash}.json`), UnitCodeSchema);

    if (unitError) {
      return { data: null, error: unitError };
    }

    code[unit] = unitCode;
  }

  return { data: { version, code }, error: null };
}

/** The video's Versions, newest first. */
export async function listVersions(dir: string, format: Format): Promise<Result<VersionSummary[], VersionError>> {
  const summaries: VersionSummary[] = [];

  for (const number of await versionNumbers(dir, format)) {
    const { data: version, error } = await readDocument(join(dir, format, VERSIONS_DIR, `${number}.json`), VersionSchema);

    if (error) {
      return { data: null, error };
    }

    summaries.push(summaryOf(version));
  }

  return { data: summaries.reverse(), error: null };
}

function summaryOf({ version, origin, createdAt, revision, restoredFrom, style, flags }: Version): VersionSummary {
  return {
    version,
    origin,
    createdAt,
    request: revision?.request,
    summary: revision?.summary ?? style,
    restoredFrom,
    fallbacks: flags.filter(({ kind }) => kind === "fallback").length,
  };
}

/**
 * Saves a copy of an earlier Version as the newest, so restoring loses nothing. Its units are the same files, shared
 * by hash; only the manifest is new. Resolves to the new Version's number.
 */
export async function restoreVersion(dir: string, format: Format, number: number, createdAt: string): Promise<Result<number, VersionError>> {
  const { data: version, error } = await readDocument(join(dir, format, VERSIONS_DIR, `${number}.json`), VersionSchema);

  if (error) {
    return { data: null, error };
  }

  const content = VideoContentSchema.parse(version);

  return saveVersion(dir, format, { ...content, origin: "restore", restoredFrom: number, createdAt });
}

async function readDocument<T>(path: string, schema: z.ZodType<T>): Promise<Result<T, VersionError>> {
  const { data: text, error } = await fileStep(path, () => readFile(path, "utf8"));

  if (error) {
    return { data: null, error };
  }

  const parsed = schema.safeParse(parseJson(text));

  if (!parsed.success) {
    return { data: null, error: { code: "INVALID_DOCUMENT", path, message: parsed.error.message } };
  }

  return { data: parsed.data, error: null };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The number of the video's newest Version; none before its first generation is saved. */
export async function latestVersion(dir: string, format: Format): Promise<number | undefined> {
  return (await versionNumbers(dir, format)).at(-1);
}

/** The numbers of the video's saved Versions, oldest first. */
async function versionNumbers(dir: string, format: Format): Promise<number[]> {
  const names = await readdir(join(dir, format, VERSIONS_DIR)).catch(() => []);

  return names
    .map((name) => /^(\d+)\.json$/.exec(name)?.[1])
    .filter((number) => number !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
