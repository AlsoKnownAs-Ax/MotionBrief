import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pin, type Sources } from "./pin.ts";
import { packTarball, sha256, startFileServer, tempDir, type FileServer } from "./test-support.ts";

let server: FileServer;
let sources: Sources;
let rootDir: string;

beforeEach(async () => {
  server = await startFileServer();
  sources = { chromeForTesting: server.url, githubApi: server.url, huggingFace: server.url, npm: server.url };
  rootDir = await tempDir();
  await writeFile(join(rootDir, "deps.json"), JSON.stringify(EXISTING));
});

afterEach(async () => {
  await server.close();
});

/** A pin the tests expect `deps:pin` to leave alone. */
const EXISTING = {
  "whisper-cli": {
    version: "native-deps-0",
    platforms: {
      "win-x64": { url: "https://example.com/whisper-win.zip", sha256: "1".repeat(64) },
      "mac-arm64": { url: "https://example.com/whisper-mac.zip", sha256: "2".repeat(64) },
    },
  },
};

describe("deps:pin", () => {
  it("pins chrome-headless-shell to a Chrome for Testing version with our own hashes", async () => {
    server.serve("/154.0.8037.57/win64/chrome-headless-shell-win64.zip", "chrome for win");
    server.serve("/154.0.8037.57/mac-arm64/chrome-headless-shell-mac-arm64.zip", "chrome for mac");

    const { error } = await pinDep("chrome-headless-shell", "154.0.8037.57");

    expect(error).toBeNull();
    expect(await manifest()).toEqual({
      "chrome-headless-shell": {
        version: "154.0.8037.57",
        platforms: {
          "win-x64": {
            url: `${server.url}/154.0.8037.57/win64/chrome-headless-shell-win64.zip`,
            sha256: sha256("chrome for win"),
          },
          "mac-arm64": {
            url: `${server.url}/154.0.8037.57/mac-arm64/chrome-headless-shell-mac-arm64.zip`,
            sha256: sha256("chrome for mac"),
          },
        },
      },
      ...EXISTING,
    });
  });

  it("pins ffmpeg to the assets of a native-deps release", async () => {
    serveRelease("native-deps-2", [
      "whisper-cli-v1.9.4-win-x64.zip",
      "ffmpeg-9.0.2-win-x64.zip",
      "ffmpeg-9.0.2-mac-arm64.zip",
      "native-deps-source.tar",
    ]);
    server.serve("/download/ffmpeg-9.0.2-win-x64.zip", "ffmpeg for win");
    server.serve("/download/ffmpeg-9.0.2-mac-arm64.zip", "ffmpeg for mac");

    const { error } = await pinDep("ffmpeg", "native-deps-2");

    expect(error).toBeNull();
    expect((await manifest()).ffmpeg).toEqual({
      version: "native-deps-2",
      platforms: {
        "win-x64": { url: `${server.url}/download/ffmpeg-9.0.2-win-x64.zip`, sha256: sha256("ffmpeg for win") },
        "mac-arm64": { url: `${server.url}/download/ffmpeg-9.0.2-mac-arm64.zip`, sha256: sha256("ffmpeg for mac") },
      },
    });
  });

  it("fails without touching deps.json when the release lacks a platform's build", async () => {
    serveRelease("native-deps-2", ["whisper-cli-v1.9.5-win-x64.zip"]);
    server.serve("/download/whisper-cli-v1.9.5-win-x64.zip", "whisper-cli for win");

    const { error } = await pinDep("whisper-cli", "native-deps-2");

    expect(error).toMatchObject({ code: "RELEASE_ASSET_MISSING", release: "native-deps-2", platform: "mac-arm64" });
    expect(await manifest()).toEqual(EXISTING);
  });

  it("pins the Whisper model to a Hugging Face commit, with its size for the free-space check", async () => {
    server.serve(`/ggerganov/whisper.cpp/resolve/${MODEL_COMMIT}/ggml-large-v3-turbo-q5_0.bin`, "the model");

    const { error } = await pinDep("whisper-model", MODEL_COMMIT);

    expect(error).toBeNull();
    expect((await manifest())["whisper-model"]).toEqual({
      version: MODEL_COMMIT,
      url: `${server.url}/ggerganov/whisper.cpp/resolve/${MODEL_COMMIT}/ggml-large-v3-turbo-q5_0.bin`,
      sha256: sha256("the model"),
      size: 9,
    });
  });

  it("refuses a model revision that can move, such as a branch", async () => {
    const { error } = await pinDep("whisper-model", "main");

    expect(error).toMatchObject({ code: "INVALID_VERSION", name: "whisper-model", version: "main" });
    expect(server.requests).toEqual([]);
  });

  it("pins the Claude Code binary from the Agent SDK's per-platform packages, and the SDK to the same version", async () => {
    await writeFile(join(rootDir, "package.json"), JSON.stringify(PACKAGE_JSON, null, 2));
    await serveClaudePackages("0.4.1");

    const { error } = await pinDep("claude", "0.4.1");

    expect(error).toBeNull();
    expect((await manifest()).claude).toEqual({
      version: "0.4.1",
      platforms: {
        "win-x64": { package: "@anthropic-ai/claude-agent-sdk-win32-x64", binary: "claude.exe", sha256: sha256("claude for win") },
        "mac-arm64": { package: "@anthropic-ai/claude-agent-sdk-darwin-arm64", binary: "claude", sha256: sha256("claude for mac") },
      },
    });
    expect(JSON.parse(await readFile(join(rootDir, "package.json"), "utf8"))).toEqual({
      ...PACKAGE_JSON,
      dependencies: { ...PACKAGE_JSON.dependencies, "@anthropic-ai/claude-agent-sdk": "0.4.1" },
    });
  });

  it("fails without touching deps.json when package.json has no dependencies to pin the Agent SDK in", async () => {
    await writeFile(join(rootDir, "package.json"), JSON.stringify({ name: "motionbrief" }));
    await serveClaudePackages("0.4.1");

    const { error } = await pinDep("claude", "0.4.1");

    expect(error).toMatchObject({ code: "PACKAGE_JSON_INVALID" });
    expect(await manifest()).toEqual(EXISTING);
  });

  it("returns a coded error when deps.json can't be written", async () => {
    server.serve(`/ggerganov/whisper.cpp/resolve/${MODEL_COMMIT}/ggml-large-v3-turbo-q5_0.bin`, "the model");
    await chmod(join(rootDir, "deps.json"), 0o444);

    const { error } = await pinDep("whisper-model", MODEL_COMMIT);

    expect(error).toMatchObject({ code: "FILE_FAILED", path: join(rootDir, "deps.json") });
  });

  it("fails without touching deps.json when a version doesn't exist upstream", async () => {
    const { error } = await pinDep("chrome-headless-shell", "1.2.3.4");

    expect(error).toMatchObject({ code: "DOWNLOAD_FAILED", url: `${server.url}/1.2.3.4/win64/chrome-headless-shell-win64.zip` });
    expect(await manifest()).toEqual(EXISTING);
  });

  it("refuses a dependency the manifest doesn't know", async () => {
    const { error } = await pinDep("ffprobe", "1");

    expect(error).toEqual({ code: "UNKNOWN_DEPENDENCY", name: "ffprobe" });
  });
});

const MODEL_COMMIT = "5359861c739e955e79d9a303bcbc70fb988958b1";

const PACKAGE_JSON = {
  name: "motionbrief",
  dependencies: { "@anthropic-ai/claude-agent-sdk": "0.3.0", zod: "4.0.0" },
};

/** Serves the Agent SDK's per-platform npm tarballs at version, each holding its Claude Code binary. */
async function serveClaudePackages(version: string) {
  server.serve(
    `/@anthropic-ai/claude-agent-sdk-win32-x64/-/claude-agent-sdk-win32-x64-${version}.tgz`,
    await packTarball({ "package/claude.exe": "claude for win", "package/package.json": "{}" }),
  );
  server.serve(
    `/@anthropic-ai/claude-agent-sdk-darwin-arm64/-/claude-agent-sdk-darwin-arm64-${version}.tgz`,
    await packTarball({ "package/claude": "claude for mac", "package/package.json": "{}" }),
  );
}

/** Answers GitHub's release API for tag with assets downloadable under /download/. */
function serveRelease(tag: string, assets: string[]) {
  const release = { assets: assets.map((name) => ({ name, browser_download_url: `${server.url}/download/${name}` })) };
  server.serve(`/repos/AlsoKnownAs-Ax/MotionBrief/releases/tags/${tag}`, JSON.stringify(release));
}

async function manifest() {
  return JSON.parse(await readFile(join(rootDir, "deps.json"), "utf8"));
}

function pinDep(name: string, version: string) {
  return pin({ rootDir, name, version, sources, log: () => {} });
}
