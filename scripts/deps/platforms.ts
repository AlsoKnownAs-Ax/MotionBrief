import type { z } from "zod";
import { PlatformSchema } from "../../src/shared/deps-manifest.ts";
import { failed, type Result } from "./result.ts";

export type Platform = z.infer<typeof PlatformSchema>;

export const PLATFORM_NAMES = PlatformSchema.options;

/** The Claude Code binary ships inside this package's per-platform optional dependencies. */
export const AGENT_SDK = "@anthropic-ai/claude-agent-sdk";

type PlatformNames = {
  /** Node's `${process.platform}-${process.arch}`. */
  node: string;
  chromeForTesting: string;
  claude: { package: string; binary: string };
};

/** How each upstream names our platforms. */
export const PLATFORMS = {
  "win-x64": {
    node: "win32-x64",
    chromeForTesting: "win64",
    claude: { package: `${AGENT_SDK}-win32-x64`, binary: "claude.exe" },
  },
  "mac-arm64": {
    node: "darwin-arm64",
    chromeForTesting: "mac-arm64",
    claude: { package: `${AGENT_SDK}-darwin-arm64`, binary: "claude" },
  },
} satisfies Record<Platform, PlatformNames>;

/** Maps Node's platform and arch to a platform MotionBrief ships for; `undefined` for any other. */
export function platformOf(platform: NodeJS.Platform, arch: string): Platform | undefined {
  return PLATFORM_NAMES.find((name) => PLATFORMS[name].node === `${platform}-${arch}`);
}

/** Runs step for each platform in turn, stopping at the first error. Give step an explicit return type. */
export async function perPlatform<T, E>(step: (platform: Platform) => Promise<Result<T, E>>): Promise<Result<Record<Platform, T>, E>> {
  const results: Partial<Record<Platform, T>> = {};

  for (const platform of PLATFORM_NAMES) {
    const result = await step(platform);

    if (failed(result)) {
      return { data: null, error: result.error };
    }

    results[platform] = result.data;
  }

  // Every platform was filled in above.
  return { data: results as Record<Platform, T>, error: null };
}
