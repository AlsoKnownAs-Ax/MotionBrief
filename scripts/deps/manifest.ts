import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { fileStep, readJsonFile, type FileError } from "./files.ts";
import { PlatformSchema } from "./platforms.ts";
import type { Result } from "./result.ts";

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, "a lowercase hex SHA-256");

const Archive = z.object({ url: z.url(), sha256: Sha256 });

/** A zip per platform, fetched from an immutable URL and unpacked into vendor/ by postinstall. */
const ArchiveDep = z.object({
  version: z.string(),
  platforms: z.record(PlatformSchema, Archive),
});

/** The Claude Code binary inside the Agent SDK's per-platform optional dependency: pnpm installs it, postinstall checks its hash. */
const ClaudeBinary = z.object({ package: z.string(), binary: z.string(), sha256: Sha256 });

const ClaudeDep = z.object({
  version: z.string(),
  platforms: z.record(PlatformSchema, ClaudeBinary),
});

/** One file for every platform, fetched by the app's first-run flow, never by postinstall. */
const ModelDep = z.object({ version: z.string(), url: z.url(), sha256: Sha256, size: z.int().positive() });

const ManifestSchema = z.object({
  "chrome-headless-shell": ArchiveDep,
  ffmpeg: ArchiveDep,
  "whisper-cli": ArchiveDep,
  claude: ClaudeDep,
  "whisper-model": ModelDep,
});

export type Manifest = z.infer<typeof ManifestSchema>;

export type DepName = keyof Manifest;

export const DEP_NAMES = ManifestSchema.keyof().options;

export function isDepName(name: string): name is DepName {
  return (DEP_NAMES as readonly string[]).includes(name);
}

export const ARCHIVE_NAMES = ["chrome-headless-shell", "ffmpeg", "whisper-cli"] as const satisfies readonly DepName[];

export type ArchiveName = (typeof ARCHIVE_NAMES)[number];

export type ManifestError = FileError | { code: "MANIFEST_INVALID"; path: string; issues: z.core.$ZodIssue[] };

/** The manifest's file name in the repo root. */
export const MANIFEST_FILE = "deps.json";

export function readManifest(path: string) {
  return readWith(ManifestSchema, path);
}

/** A manifest that may lack entries, so `deps:pin` can add a dependency to it. */
export type PartialManifest = Partial<Manifest>;

export function readPartialManifest(path: string) {
  return readWith(ManifestSchema.partial(), path);
}

/** Writes entries in the schema's order, so a re-pin changes only its own lines. */
export function writeManifest(path: string, manifest: PartialManifest): Promise<Result<void, FileError>> {
  const ordered = Object.fromEntries(DEP_NAMES.filter((name) => manifest[name]).map((name) => [name, manifest[name]]));

  return fileStep(path, () => writeFile(path, `${JSON.stringify(ordered, null, 2)}\n`));
}

async function readWith<T>(schema: z.ZodType<T>, path: string): Promise<Result<T, ManifestError>> {
  const { data: json, error } = await readJsonFile(path);

  if (error) {
    return { data: null, error };
  }

  const { success, data: manifest, error: parseError } = schema.safeParse(json);

  if (!success) {
    return { data: null, error: { code: "MANIFEST_INVALID", path, issues: parseError.issues } };
  }

  return { data: manifest, error: null };
}
