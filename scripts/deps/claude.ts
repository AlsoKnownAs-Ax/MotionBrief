import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { fileStep, readJsonFile, sha256File } from "./files.ts";
import type { Manifest } from "./manifest.ts";
import { AGENT_SDK, type Platform } from "./platforms.ts";
import type { Result } from "./result.ts";

export type ClaudeError =
  | { code: "CLAUDE_SDK_MISSING"; message: string }
  | { code: "CLAUDE_SDK_VERSION"; installed: string; pinned: string }
  | { code: "CLAUDE_BINARY_MISSING"; path: string; message: string }
  | { code: "CLAUDE_HASH_MISMATCH"; path: string; expected: string; actual: string };

type CheckClaudeOptions = {
  dep: Manifest["claude"];
  platform: Platform;
  rootDir: string;
};

/** Checks that the install holds the pinned Agent SDK and that its Claude Code binary has the pinned hash. */
export async function checkClaude({ dep, platform, rootDir }: CheckClaudeOptions): Promise<Result<null, ClaudeError>> {
  const { data: sdk, error } = await readSdk(rootDir);

  if (error) {
    return { data: null, error };
  }

  if (sdk.version !== dep.version) {
    return { data: null, error: { code: "CLAUDE_SDK_VERSION", installed: sdk.version, pinned: dep.version } };
  }

  const pin = dep.platforms[platform];
  const { data: binary, error: binaryError } = await hashBinary(sdk.dir, pin.package, pin.binary);

  if (binaryError) {
    return { data: null, error: binaryError };
  }

  if (binary.sha256 !== pin.sha256) {
    return { data: null, error: { code: "CLAUDE_HASH_MISMATCH", path: binary.path, expected: pin.sha256, actual: binary.sha256 } };
  }

  return { data: null, error: null };
}

const SdkPackageJsonSchema = z.object({ version: z.string() });

async function readSdk(rootDir: string): Promise<Result<{ dir: string; version: string }, ClaudeError>> {
  const linked = join(rootDir, "node_modules", AGENT_SDK);
  // pnpm links the SDK from its store, where its optional dependencies sit next to it.
  const { data: dir, error } = await fileStep(linked, () => realpath(linked));

  if (error) {
    return { data: null, error: { code: "CLAUDE_SDK_MISSING", message: error.message } };
  }

  const { data: json, error: readError } = await readJsonFile(join(dir, "package.json"));

  if (readError) {
    return { data: null, error: { code: "CLAUDE_SDK_MISSING", message: readError.message } };
  }

  const { success, data: packageJson, error: parseError } = SdkPackageJsonSchema.safeParse(json);

  if (!success) {
    return { data: null, error: { code: "CLAUDE_SDK_MISSING", message: `its package.json is invalid: ${parseError.message}` } };
  }

  return { data: { dir, version: packageJson.version }, error: null };
}

async function hashBinary(sdkDir: string, platformPackage: string, binary: string): Promise<Result<{ path: string; sha256: string }, ClaudeError>> {
  const packageDir = findPackageDir(sdkDir, platformPackage);

  if (!packageDir) {
    return {
      data: null,
      error: { code: "CLAUDE_BINARY_MISSING", path: `${platformPackage}/${binary}`, message: `${platformPackage} isn't installed` },
    };
  }

  const path = join(packageDir, binary);
  const { data: sha256, error } = await fileStep(path, () => sha256File(path));

  if (error) {
    return { data: null, error: { code: "CLAUDE_BINARY_MISSING", path, message: error.message } };
  }

  return { data: { path, sha256 }, error: null };
}

/**
 * Looks for a package in the node_modules folders above dir, as Node resolves a dependency of the package in dir.
 * Unlike require.resolve it ignores NODE_PATH, which pnpm points at every package in its store.
 */
function findPackageDir(dir: string, name: string): string | undefined {
  const candidate = join(dir, "node_modules", name);

  if (existsSync(join(candidate, "package.json"))) {
    return candidate;
  }

  const parent = dirname(dir);

  if (parent === dir) {
    return undefined;
  }

  return findPackageDir(parent, name);
}
