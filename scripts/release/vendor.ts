import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkClaude, type ClaudeError } from "../deps/claude.ts";
import { fileStep } from "../deps/files.ts";
import { ARCHIVE_NAMES, FILE_NAMES, MANIFEST_FILE, readManifest, type ArchiveName, type FileName, type ManifestError } from "../deps/manifest.ts";
import { platformOf } from "../deps/platforms.ts";
import type { Result } from "../deps/result.ts";

export type VendorError =
  | ManifestError
  | ClaudeError
  | { code: "UNSUPPORTED_PLATFORM"; platform: string; arch: string }
  /** `actual` is the pin vendor/<name> was installed from; absent when it was never installed. */
  | { code: "VENDOR_MISMATCH"; name: ArchiveName | FileName; expected: string; actual?: string };

type CheckVendorOptions = {
  rootDir: string;
  /** The platform and arch being packed, in Node's names. */
  platform: string;
  arch: string;
};

/**
 * The packager's half of ADR 0002: everything packed from vendor/ was installed at the manifest's pin for the
 * platform being packed, and the Claude Code binary has its pinned hash. Postinstall only ever writes a pin file
 * next to a complete, verified install, so the pin files are the record of what vendor/ holds.
 */
export async function checkVendor({ rootDir, platform, arch }: CheckVendorOptions): Promise<Result<null, VendorError>> {
  const target = platformOf(platform as NodeJS.Platform, arch);

  if (!target) {
    return { data: null, error: { code: "UNSUPPORTED_PLATFORM", platform, arch } };
  }

  const { data: manifest, error } = await readManifest(join(rootDir, MANIFEST_FILE));

  if (error) {
    return { data: null, error };
  }

  const pins = [
    ...ARCHIVE_NAMES.map((name) => ({ name, expected: manifest[name].platforms[target].sha256 })),
    ...FILE_NAMES.map((name) => ({ name, expected: manifest[name].sha256 })),
  ];

  for (const { name, expected } of pins) {
    const actual = await installedPin(rootDir, name);

    if (actual !== expected) {
      return { data: null, error: { code: "VENDOR_MISMATCH", name, expected, ...(actual && { actual }) } };
    }
  }

  return checkClaude({ dep: manifest.claude, platform: target, rootDir });
}

async function installedPin(rootDir: string, name: ArchiveName | FileName) {
  if (!existsSync(join(rootDir, "vendor", name))) {
    return undefined;
  }

  const pinFile = join(rootDir, "vendor", `${name}.sha256`);
  const { data: pin } = await fileStep(pinFile, () => readFile(pinFile, "utf8"));

  return pin?.trim();
}
