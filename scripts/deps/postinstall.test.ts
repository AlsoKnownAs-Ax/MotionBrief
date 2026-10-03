import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Manifest } from "./manifest.ts";
import { runPostinstall } from "./postinstall.ts";
import { packZip, sha256, startFileServer, tempDir, type FileServer } from "./test-support.ts";

let server: FileServer;
let rootDir: string;

beforeEach(async () => {
  server = await startFileServer();
  rootDir = await tempDir();
  await installAgentSdk();
});

afterEach(async () => {
  await server.close();
});

describe("postinstall", () => {
  it("fetches each pinned archive for this platform into vendor/", async () => {
    await writeManifest(await servedManifest());

    const { error } = await postinstall();

    expect(error).toBeNull();
    expect(await vendorFile("chrome-headless-shell/chrome-headless-shell-win64/chrome.txt")).toBe("chrome for win");
    expect(await vendorFile("ffmpeg/ffmpeg.txt")).toBe("ffmpeg for win");
    expect(await vendorFile("whisper-cli/whisper-cli.txt")).toBe("whisper-cli for win");
  });

  it("refuses an archive whose hash doesn't match the manifest, leaving nothing of it behind", async () => {
    const manifest = await servedManifest();
    server.serve("/ffmpeg-win.zip", await packZip({ "ffmpeg.txt": "tampered" }));
    await writeManifest(manifest);

    const { error } = await postinstall();

    expect(error).toMatchObject({
      code: "HASH_MISMATCH",
      name: "ffmpeg",
      expected: manifest.ffmpeg.platforms["win-x64"].sha256,
    });
    expect(await vendorEntries()).not.toContainEqual(expect.stringContaining("ffmpeg"));
  });

  it("refuses an installed Agent SDK other than the pinned version", async () => {
    await writeManifest(await servedManifest());
    await installAgentSdk({ version: "0.4.0" });

    const { error } = await postinstall();

    expect(error).toEqual({ code: "CLAUDE_SDK_VERSION", installed: "0.4.0", pinned: "0.3.0" });
  });

  it("refuses a Claude Code binary whose hash doesn't match the manifest", async () => {
    await writeManifest(await servedManifest());
    await installAgentSdk({ binary: "tampered" });

    const { error } = await postinstall();

    expect(error).toMatchObject({ code: "CLAUDE_HASH_MISMATCH", expected: sha256(CLAUDE_WIN), actual: sha256("tampered") });
  });

  it("fails when the Agent SDK's package for this platform wasn't installed", async () => {
    await writeManifest(await servedManifest());
    await rm(join(rootDir, "node_modules/@anthropic-ai/claude-agent-sdk-win32-x64"), { recursive: true });

    const { error } = await postinstall();

    expect(error).toMatchObject({ code: "CLAUDE_BINARY_MISSING" });
  });

  it("fails when a pinned URL can't be fetched", async () => {
    const manifest = await servedManifest();
    manifest["whisper-cli"].platforms["win-x64"].url = `${server.url}/gone.zip`;
    await writeManifest(manifest);

    const { error } = await postinstall();

    expect(error).toMatchObject({ code: "DOWNLOAD_FAILED", url: `${server.url}/gone.zip` });
  });

  it("refuses a manifest that doesn't pin every dependency", async () => {
    const manifest: Partial<Manifest> = await servedManifest();
    delete manifest.ffmpeg;
    await writeFile(join(rootDir, "deps.json"), JSON.stringify(manifest));

    const { error } = await postinstall();

    expect(error).toMatchObject({ code: "MANIFEST_INVALID" });
    expect(server.requests).toEqual([]);
  });

  it("leaves the Whisper model and other platforms' archives alone", async () => {
    await writeManifest(await servedManifest());

    await postinstall();

    expect(server.requests).toEqual(["/chrome-win.zip", "/ffmpeg-win.zip", "/whisper-win.zip"]);
  });

  it("fetches nothing again that is already installed at its pin", async () => {
    await writeManifest(await servedManifest());
    await postinstall();
    server.requests.length = 0;

    const { error } = await postinstall();

    expect(error).toBeNull();
    expect(server.requests).toEqual([]);
  });

  it("replaces an installed archive when its pin changes", async () => {
    const manifest = await servedManifest();
    await writeManifest(manifest);
    await postinstall();
    const repinned = await packZip({ "ffmpeg-next.txt": "newer ffmpeg" });
    server.serve("/ffmpeg-win-next.zip", repinned);
    manifest.ffmpeg.platforms["win-x64"] = { url: `${server.url}/ffmpeg-win-next.zip`, sha256: sha256(repinned) };
    await writeManifest(manifest);
    server.requests.length = 0;

    const { error } = await postinstall();

    expect(error).toBeNull();
    expect(server.requests).toEqual(["/ffmpeg-win-next.zip"]);
    expect(await vendorFile("ffmpeg/ffmpeg-next.txt")).toBe("newer ffmpeg");
    await expect(vendorFile("ffmpeg/ffmpeg.txt")).rejects.toThrow();
  });

  it("fetches nothing with MOTIONBRIEF_SKIP_DEPS=1", async () => {
    await writeManifest(await servedManifest());

    const { error } = await postinstall({ MOTIONBRIEF_SKIP_DEPS: "1" });

    expect(error).toBeNull();
    expect(server.requests).toEqual([]);
  });

  it("fetches nothing on a platform MotionBrief doesn't ship for", async () => {
    await writeManifest(await servedManifest());

    const { error } = await runPostinstall({ rootDir, env: {}, platform: "linux", arch: "x64", log: () => {} });

    expect(error).toBeNull();
    expect(server.requests).toEqual([]);
  });
});

/** Serves a zip per archive dependency and platform, plus the model, and returns a manifest pinning them. */
async function servedManifest(): Promise<Manifest> {
  const archive = async (path: string, files: Record<string, string>) => {
    const body = await packZip(files);
    server.serve(path, body);

    return { url: `${server.url}${path}`, sha256: sha256(body) };
  };
  server.serve("/model.bin", MODEL);

  return {
    "chrome-headless-shell": {
      version: "154.0.0.0",
      platforms: {
        "win-x64": await archive("/chrome-win.zip", { "chrome-headless-shell-win64/chrome.txt": "chrome for win" }),
        "mac-arm64": await archive("/chrome-mac.zip", { "chrome-headless-shell-mac-arm64/chrome.txt": "chrome for mac" }),
      },
    },
    ffmpeg: {
      version: "native-deps-1",
      platforms: {
        "win-x64": await archive("/ffmpeg-win.zip", { "ffmpeg.txt": "ffmpeg for win" }),
        "mac-arm64": await archive("/ffmpeg-mac.zip", { "ffmpeg.txt": "ffmpeg for mac" }),
      },
    },
    "whisper-cli": {
      version: "native-deps-1",
      platforms: {
        "win-x64": await archive("/whisper-win.zip", { "whisper-cli.txt": "whisper-cli for win" }),
        "mac-arm64": await archive("/whisper-mac.zip", { "whisper-cli.txt": "whisper-cli for mac" }),
      },
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
      url: `${server.url}/model.bin`,
      sha256: sha256(MODEL),
      size: MODEL.length,
    },
  };
}

const MODEL = "the model";

const CLAUDE_WIN = "claude for win";

/** Lays out node_modules as an install leaves it: the Agent SDK and its optional dependency for this platform. */
async function installAgentSdk({ version = "0.3.0", binary = CLAUDE_WIN } = {}) {
  const sdk = join(rootDir, "node_modules/@anthropic-ai/claude-agent-sdk");
  const platformPackage = join(rootDir, "node_modules/@anthropic-ai/claude-agent-sdk-win32-x64");
  await mkdir(sdk, { recursive: true });
  await mkdir(platformPackage, { recursive: true });
  await writeFile(join(sdk, "package.json"), JSON.stringify({ name: "@anthropic-ai/claude-agent-sdk", version }));
  await writeFile(
    join(platformPackage, "package.json"),
    JSON.stringify({ name: "@anthropic-ai/claude-agent-sdk-win32-x64", version }),
  );
  await writeFile(join(platformPackage, "claude.exe"), binary);
}

async function writeManifest(manifest: Manifest) {
  await writeFile(join(rootDir, "deps.json"), JSON.stringify(manifest));
}

async function vendorEntries() {
  return readdir(join(rootDir, "vendor"));
}

async function vendorFile(path: string) {
  return readFile(join(rootDir, "vendor", path), "utf8");
}

function postinstall(env: Record<string, string> = {}) {
  return runPostinstall({ rootDir, env, platform: "win32", arch: "x64", log: () => {} });
}
