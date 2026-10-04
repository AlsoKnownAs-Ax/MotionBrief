import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Manifest } from "../deps/manifest.ts";
import { sha256, tempDir } from "../deps/test-support.ts";
import { checkVendor } from "./vendor.ts";

let rootDir: string;

beforeEach(async () => {
  rootDir = await tempDir();
  await writeFile(join(rootDir, "deps.json"), JSON.stringify(MANIFEST));
  await installAgentSdk(CLAUDE_WIN);
});

describe("checkVendor", () => {
  it("passes a vendor/ that postinstall filled at the manifest's pins for the platform being packed", async () => {
    await vendorAt("win-x64");

    const { error } = await checkVendor({ rootDir, platform: "win32", arch: "x64" });

    expect(error).toBeNull();
  });

  it("refuses an archive installed from another pin", async () => {
    await vendorAt("win-x64");
    await writeFile(join(rootDir, "vendor", "ffmpeg.sha256"), `${sha256("an older ffmpeg")}\n`);

    const { error } = await checkVendor({ rootDir, platform: "win32", arch: "x64" });

    expect(error).toEqual({
      code: "VENDOR_MISMATCH",
      name: "ffmpeg",
      expected: sha256("ffmpeg for win"),
      actual: sha256("an older ffmpeg"),
    });
  });

  it("refuses a vendor/ filled for another platform", async () => {
    await vendorAt("win-x64");

    const { error } = await checkVendor({ rootDir, platform: "darwin", arch: "arm64" });

    expect(error).toMatchObject({ code: "VENDOR_MISMATCH", name: "chrome-headless-shell" });
  });

  it("refuses a dependency that was never fetched", async () => {
    await vendorAt("win-x64");
    await rm(join(rootDir, "vendor", "whisper-cli"), { recursive: true });

    const { error } = await checkVendor({ rootDir, platform: "win32", arch: "x64" });

    expect(error).toEqual({ code: "VENDOR_MISMATCH", name: "whisper-cli", expected: sha256("whisper-cli for win") });
  });

  it("refuses a VAD model installed from another pin", async () => {
    await vendorAt("win-x64");
    await writeFile(join(rootDir, "vendor", "whisper-vad-model.sha256"), `${sha256("another model")}\n`);

    const { error } = await checkVendor({ rootDir, platform: "win32", arch: "x64" });

    expect(error).toMatchObject({ code: "VENDOR_MISMATCH", name: "whisper-vad-model" });
  });

  it("refuses a Claude Code binary whose hash doesn't match the manifest", async () => {
    await vendorAt("win-x64");
    await installAgentSdk("tampered");

    const { error } = await checkVendor({ rootDir, platform: "win32", arch: "x64" });

    expect(error).toMatchObject({ code: "CLAUDE_HASH_MISMATCH", expected: sha256(CLAUDE_WIN) });
  });

  it("refuses a platform MotionBrief doesn't ship for", async () => {
    const { error } = await checkVendor({ rootDir, platform: "linux", arch: "x64" });

    expect(error).toEqual({ code: "UNSUPPORTED_PLATFORM", platform: "linux", arch: "x64" });
  });
});

const CLAUDE_WIN = "claude for win";

function archive(name: string) {
  return { url: `https://example.invalid/${encodeURIComponent(name)}.zip`, sha256: sha256(name) };
}

const MANIFEST: Manifest = {
  "chrome-headless-shell": {
    version: "154.0.0.0",
    platforms: { "win-x64": archive("chrome for win"), "mac-arm64": archive("chrome for mac") },
  },
  ffmpeg: {
    version: "native-deps-1",
    platforms: { "win-x64": archive("ffmpeg for win"), "mac-arm64": archive("ffmpeg for mac") },
  },
  "whisper-cli": {
    version: "native-deps-1",
    platforms: { "win-x64": archive("whisper-cli for win"), "mac-arm64": archive("whisper-cli for mac") },
  },
  claude: {
    version: "0.3.0",
    platforms: {
      "win-x64": { package: "@anthropic-ai/claude-agent-sdk-win32-x64", binary: "claude.exe", sha256: sha256(CLAUDE_WIN) },
      "mac-arm64": { package: "@anthropic-ai/claude-agent-sdk-darwin-arm64", binary: "claude", sha256: sha256("claude for mac") },
    },
  },
  "whisper-model": {
    version: "0123456789abcdef0123456789abcdef01234567",
    url: "https://example.invalid/model.bin",
    sha256: sha256("the model"),
    size: 9,
  },
  "whisper-vad-model": {
    version: "89abcdef0123456789abcdef0123456789abcdef",
    url: "https://example.invalid/vad.bin",
    sha256: sha256("the VAD model"),
  },
};

/** Lays out vendor/ as postinstall leaves it: each dependency's folder next to the pin it was installed from. */
async function vendorAt(platform: "win-x64" | "mac-arm64") {
  const pins = {
    "chrome-headless-shell": MANIFEST["chrome-headless-shell"].platforms[platform].sha256,
    ffmpeg: MANIFEST.ffmpeg.platforms[platform].sha256,
    "whisper-cli": MANIFEST["whisper-cli"].platforms[platform].sha256,
    "whisper-vad-model": MANIFEST["whisper-vad-model"].sha256,
  };

  for (const [name, pin] of Object.entries(pins)) {
    await mkdir(join(rootDir, "vendor", name), { recursive: true });
    await writeFile(join(rootDir, "vendor", `${name}.sha256`), `${pin}\n`);
  }
}

async function installAgentSdk(binary: string) {
  const sdk = join(rootDir, "node_modules/@anthropic-ai/claude-agent-sdk");
  const platformPackage = join(rootDir, "node_modules/@anthropic-ai/claude-agent-sdk-win32-x64");
  await mkdir(sdk, { recursive: true });
  await mkdir(platformPackage, { recursive: true });
  await writeFile(join(sdk, "package.json"), JSON.stringify({ name: "@anthropic-ai/claude-agent-sdk", version: "0.3.0" }));
  await writeFile(join(platformPackage, "package.json"), JSON.stringify({ name: "@anthropic-ai/claude-agent-sdk-win32-x64", version: "0.3.0" }));
  await writeFile(join(platformPackage, "claude.exe"), binary);
}
