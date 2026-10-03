import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";

export type Result<T, E> = { data: T; error: null } | { data: null; error: E };

/** The platforms MotionBrief ships for, named as the native-deps workflow names them (ADR 0002). */
export const PLATFORMS = ["win-x64", "mac-arm64"] as const;

export type Platform = (typeof PLATFORMS)[number];

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, "a lowercase hex SHA-256");

const Archive = z.object({ url: z.url(), sha256: Sha256 });

/** A zip per platform, fetched from an immutable URL and unpacked into vendor/ by postinstall. */
const ArchiveDep = z.object({
  version: z.string(),
  platforms: z.object({ "win-x64": Archive, "mac-arm64": Archive }),
});

/** The Claude Code binary inside the Agent SDK's per-platform optional dependency: pnpm installs it, postinstall checks its hash. */
const ClaudeBinary = z.object({ package: z.string(), binary: z.string(), sha256: Sha256 });

const ClaudeDep = z.object({
  version: z.string(),
  platforms: z.object({ "win-x64": ClaudeBinary, "mac-arm64": ClaudeBinary }),
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

export type ManifestError =
  | { code: "MANIFEST_UNREADABLE"; path: string; message: string }
  | { code: "MANIFEST_INVALID"; path: string; issues: z.core.$ZodIssue[] };

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
export async function writeManifest(path: string, manifest: PartialManifest) {
  const ordered = Object.fromEntries(DEP_NAMES.filter((name) => manifest[name]).map((name) => [name, manifest[name]]));
  await writeFile(path, `${JSON.stringify(ordered, null, 2)}\n`);
}

/** Maps Node's platform and arch to a platform MotionBrief ships for; `undefined` for any other. */
export function platformOf(platform: NodeJS.Platform, arch: string): Platform | undefined {
  return NODE_PLATFORMS[`${platform}-${arch}`];
}

const NODE_PLATFORMS: Record<string, Platform> = {
  "win32-x64": "win-x64",
  "darwin-arm64": "mac-arm64",
};

async function readWith<T>(schema: z.ZodType<T>, path: string): Promise<Result<T, ManifestError>> {
  const { data: json, error } = await readJson(path);

  if (error) {
    return { data: null, error };
  }

  const { success, data: manifest, error: parseError } = schema.safeParse(json);

  if (!success) {
    return { data: null, error: { code: "MANIFEST_INVALID", path, issues: parseError.issues } };
  }

  return { data: manifest, error: null };
}

async function readJson(path: string): Promise<Result<unknown, ManifestError>> {
  try {
    return { data: JSON.parse(await readFile(path, "utf8")), error: null };
  } catch (error) {
    return { data: null, error: { code: "MANIFEST_UNREADABLE", path, message: String(error) } };
  }
}
