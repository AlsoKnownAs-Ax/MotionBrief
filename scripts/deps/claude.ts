import { existsSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sha256File } from "./files.ts";
import type { Manifest, Platform, Result } from "./manifest.ts";

/** The Claude Code binary ships inside this package's per-platform optional dependencies. */
export const AGENT_SDK = "@anthropic-ai/claude-agent-sdk";

/** npm's name for the Agent SDK's package on each platform, and the binary in it. */
export const CLAUDE_PACKAGES = {
  "win-x64": { package: `${AGENT_SDK}-win32-x64`, binary: "claude.exe" },
  "mac-arm64": { package: `${AGENT_SDK}-darwin-arm64`, binary: "claude" },
} satisfies Record<Platform, { package: string; binary: string }>;

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
  const { data: binary, error: binaryError } = await hashBinary(sdk.packageJson, pin.package, pin.binary);

  if (binaryError) {
    return { data: null, error: binaryError };
  }

  if (binary.sha256 !== pin.sha256) {
    return { data: null, error: { code: "CLAUDE_HASH_MISMATCH", path: binary.path, expected: pin.sha256, actual: binary.sha256 } };
  }

  return { data: null, error: null };
}

async function readSdk(rootDir: string): Promise<Result<{ packageJson: string; version: string }, ClaudeError>> {
  try {
    // pnpm links the SDK from its store, where its optional dependencies resolve from the real path.
    const packageJson = await realpath(join(rootDir, "node_modules", AGENT_SDK, "package.json"));
    const { version } = JSON.parse(await readFile(packageJson, "utf8")) as { version: string };

    return { data: { packageJson, version }, error: null };
  } catch (error) {
    return { data: null, error: { code: "CLAUDE_SDK_MISSING", message: String(error) } };
  }
}

async function hashBinary(
  sdkPackageJson: string,
  platformPackage: string,
  binary: string,
): Promise<Result<{ path: string; sha256: string }, ClaudeError>> {
  const packageDir = findPackageDir(dirname(sdkPackageJson), platformPackage);

  if (!packageDir) {
    return {
      data: null,
      error: { code: "CLAUDE_BINARY_MISSING", path: `${platformPackage}/${binary}`, message: `${platformPackage} isn't installed` },
    };
  }

  const path = join(packageDir, binary);

  try {
    return { data: { path, sha256: await sha256File(path) }, error: null };
  } catch (error) {
    return { data: null, error: { code: "CLAUDE_BINARY_MISSING", path, message: String(error) } };
  }
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
