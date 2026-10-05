// Runs inside a packaged MotionBrief as Node (ELECTRON_RUN_AS_NODE=1), started by smoke.ts. It loads the core the
// way the app's utilityProcess does, from app.asar, and drives it over a MessagePort: so every module reads its
// files from the archive and spawns the executables electron-builder unpacked next to it. Plain JS: Electron's
// Node doesn't strip types.
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { MessageChannel } from "node:worker_threads";

const [resourcesDir, fixturesDir, outDir] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const appDir = join(resourcesDir, "app.asar");
const unpackedDir = join(resourcesDir, "app.asar.unpacked");
const isWindows = process.platform === "win32";

/** One step per line, so a failure points at what broke. */
async function step(name, run) {
  const started = Date.now();
  const detail = await run();
  console.log(`ok  ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)${detailText(detail)}`);
}

function detailText(detail) {
  if (!detail) {
    return "";
  }

  return `: ${detail}`;
}

/** An executable's file name on this platform. */
function executable(name) {
  if (!isWindows) {
    return name;
  }

  return `${name}.exe`;
}

/** The Claude Agent SDK's native package for each platform the release smoke-tests. */
const CLAUDE_PACKAGES = { win32: "claude-agent-sdk-win32-x64", darwin: "claude-agent-sdk-darwin-arm64" };

function check(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/** Runs an executable from app.asar.unpacked and returns its first line of output. */
function runUnpacked(relativePath, args, env = {}) {
  const path = join(unpackedDir, relativePath);
  check(existsSync(path), `${path} isn't unpacked`);
  const result = spawnSync(path, args, { encoding: "utf8", env: { ...process.env, ...env }, timeout: 60_000 });
  check(result.status === 0, `${path} ${args.join(" ")} exited with ${result.status ?? result.signal}: ${result.error ?? result.stderr}`);

  return `${result.stdout}${result.stderr}`.trim().split(/\r?\n/)[0];
}

/** The packaged app's copy of a package, imported as ESM from inside the archive. */
function importFromApp(specifier) {
  const require = createRequire(join(appDir, "package.json"));

  return import(pathToFileURL(require.resolve(specifier)).href);
}

/** The core's entry chunk, which main hands to utilityProcess.fork: the one file in out/main besides main's own. */
function coreEntry() {
  const mainDir = join(appDir, "out", "main");
  const chunks = readdirSync(mainDir).filter((file) => file.endsWith(".js") && file !== "index.js");
  check(chunks.length === 1, `expected one core chunk in ${mainDir}, found ${chunks.join(", ") || "none"}`);

  return join(mainDir, chunks[0]);
}

/** Stands in for the utilityProcess parent port: the core asks it for the stored Claude connection, and gets none. */
function fakeParentPort() {
  const port = new EventEmitter();
  port.postMessage = (message) => {
    if (message?.channel === "connection-store") {
      setImmediate(() => port.emit("message", { data: { channel: message.channel, id: message.id, connection: {} } }));
    }
  };

  return port;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function goodUnits() {
  const unit = async (id) => {
    const [css, html, js] = await Promise.all(["css", "html", "js"].map((part) => readFile(join(fixturesDir, "checker", "good", `${id}.${part}`), "utf8")));

    return { css, html, js };
  };

  return { s01: await unit("s01"), s02: await unit("s02") };
}

const parentPort = fakeParentPort();
process.parentPort = parentPort;
await import(pathToFileURL(coreEntry()).href);

const { port1, port2 } = new MessageChannel();
parentPort.emit("message", { ports: [port1] });
const { createORPCClient } = await importFromApp("@orpc/client");
const { RPCLink } = await importFromApp("@orpc/client/message-port");
const core = createORPCClient(new RPCLink({ port: port2 }));
port2.start();

await step("core answers", async () => `version ${(await core.system.info()).appVersion}`);

await step("Checker passes the good fixture (hyperframes check in chrome-headless-shell)", async () => {
  const [blueprint] = await core.style.presets();
  const report = await core.checker.check({
    storyboard: await readJson(join(fixturesDir, "checker", "storyboard.json")),
    transcript: await readJson(join(fixturesDir, "checker", "transcript.json")),
    rules: { format: "horizontal", captions: false, transitions: ["cut", "crossfade", "push", "zoom-through", "carry-over", "camera"], canvas: "where-it-helps" },
    preset: blueprint,
    code: await goodUnits(),
  });
  check(report.findings.length === 0, `findings: ${JSON.stringify(report.findings)}`);
});

await step("exports the fixture Project to MP4 (producer, chrome-headless-shell, FFmpeg)", async () => {
  const { projectId, preview } = await core.preview.openSample();
  const path = join(outDir, "smoke.mp4");
  let last;

  for await (const status of await core.export.mp4({ previewId: preview.id, path, video: { projectId, format: preview.timeline.format } })) {
    last = status;
  }

  check(last?.state === "done", `export ended with ${JSON.stringify(last)}`);

  return `${(statSync(path).size / 1e6).toFixed(1)} MB`;
});

await step("whisper-cli runs", async () =>
  // The CPU backend: a Vulkan driver can crash it while loading (see the Transcriber's CPU retry).
  runUnpacked(join("vendor", "whisper-cli", executable("whisper-cli")), ["--version"], { GGML_VK_VISIBLE_DEVICES: "" }),
);

await step("FFprobe runs", async () => runUnpacked(join("vendor", "ffmpeg", executable("ffprobe")), ["-version"]));

await step("the bundled Claude Code binary runs", async () => {
  const platformPackage = CLAUDE_PACKAGES[process.platform] ?? CLAUDE_PACKAGES.darwin;

  return runUnpacked(join("node_modules", "@anthropic-ai", platformPackage, executable("claude")), ["--version"], {
    DISABLE_AUTOUPDATER: "1",
  });
});

process.exit(0);
