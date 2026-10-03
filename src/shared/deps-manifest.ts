import { z } from "zod";

/**
 * The shape of deps.json, which pins every native dependency to the app release (ADR 0002). The scripts that fetch
 * and pin dependencies and the core's transcription model download both read it, so it imports nothing but zod.
 */

/** The platforms MotionBrief ships for, named as the native-deps workflow names them. */
export const PlatformSchema = z.enum(["win-x64", "mac-arm64"]);

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

/** One file for every platform, fetched by the app's first-run setup, never by postinstall. */
export const ModelDepSchema = z.object({ version: z.string(), url: z.url(), sha256: Sha256, size: z.int().positive() });

export const ManifestSchema = z.object({
  "chrome-headless-shell": ArchiveDep,
  ffmpeg: ArchiveDep,
  "whisper-cli": ArchiveDep,
  claude: ClaudeDep,
  "whisper-model": ModelDepSchema,
});

export type Manifest = z.infer<typeof ManifestSchema>;

export type ModelDep = z.infer<typeof ModelDepSchema>;
