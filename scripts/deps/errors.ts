import type { z } from "zod";
import type { PinError } from "./pin.ts";
import type { PostinstallError } from "./postinstall.ts";

type DepsError = PostinstallError | PinError;

/** One line a contributor or maintainer can act on. */
export function describeError(error: DepsError) {
  return MESSAGES[error.code](error as never);
}

const MESSAGES = {
  FILE_FAILED: (error) => `${error.path}: ${error.message}`,
  MANIFEST_INVALID: (error) => `${error.path} is invalid: ${describeIssues(error.issues)}`,
  PACKAGE_JSON_INVALID: (error) => `Can't pin the Agent SDK in ${error.path}: ${describeIssues(error.issues)}`,
  DOWNLOAD_FAILED: (error) => `Downloading ${error.url} failed: ${error.message}`,
  EXTRACT_FAILED: (error) => `Couldn't unpack ${error.archive}: ${error.message}`,
  HASH_MISMATCH: (error) =>
    `Refusing ${error.name} from ${error.url}: its SHA-256 is ${error.actual}, but deps.json pins ${error.expected}.`,
  CLAUDE_SDK_MISSING: (error) => `The Agent SDK isn't installed: ${error.message}`,
  CLAUDE_SDK_VERSION: (error) =>
    `The installed Agent SDK is ${error.installed}, but deps.json pins ${error.pinned}. Pin both with pnpm deps:pin claude <version>.`,
  CLAUDE_BINARY_MISSING: (error) =>
    `The Claude Code binary ${error.path} isn't installed (was pnpm install run without optional dependencies?): ${error.message}`,
  CLAUDE_HASH_MISMATCH: (error) =>
    `Refusing the Claude Code binary ${error.path}: its SHA-256 is ${error.actual}, but deps.json pins ${error.expected}.`,
  UNKNOWN_DEPENDENCY: (error) => `deps.json has no dependency named "${error.name}".`,
  INVALID_VERSION: (error) => `"${error.version}" can't pin ${error.name}: expected ${error.expected}.`,
  RELEASE_ASSET_MISSING: (error) => `Release ${error.release} has no ${error.name} build for ${error.platform}.`,
} satisfies { [Code in DepsError["code"]]: (error: Extract<DepsError, { code: Code }>) => string };

function describeIssues(issues: z.core.$ZodIssue[]) {
  return issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
}
