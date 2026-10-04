import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";

/** The Agent SDK's per-platform package holding its bundled Claude Code binary, as pinned in deps.json. */
const PLATFORM_PACKAGES: Record<string, { name: string; binary: string } | undefined> = {
  "win32-x64": { name: "@anthropic-ai/claude-agent-sdk-win32-x64", binary: "claude.exe" },
  "darwin-arm64": { name: "@anthropic-ai/claude-agent-sdk-darwin-arm64", binary: "claude" },
};

/**
 * Finds the bundled, unmodified `claude` next to the Agent SDK, as Node resolves the SDK's own
 * optional dependency. In a packaged app the binary sits outside the asar archive.
 */
export function bundledClaudePath(): string | undefined {
  const pin = PLATFORM_PACKAGES[`${process.platform}-${process.arch}`];

  if (!pin) {
    return undefined;
  }

  const sdkRequire = createRequire(createRequire(import.meta.url).resolve("@anthropic-ai/claude-agent-sdk"));
  const { data: packageJson } = resolveFrom(sdkRequire, `${pin.name}/package.json`);

  if (!packageJson) {
    return undefined;
  }

  const path = join(dirname(packageJson), pin.binary).replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);

  if (!existsSync(path)) {
    return undefined;
  }

  return path;
}

function resolveFrom(require: NodeJS.Require, id: string) {
  try {
    return { data: require.resolve(id), error: null };
  } catch (error) {
    return { data: null, error };
  }
}
