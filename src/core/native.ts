import { join } from "node:path";

/**
 * Where vendor/ sits: the repo root in development (this file runs from src/core in tests and from out/main when
 * built). A packaged app's root is app.asar, and electron-builder.yml unpacks vendor/ next to it, since
 * executables can't run from inside the archive.
 */
const ROOT = join(import.meta.dirname, "..", "..").replace(/app\.asar$/, "app.asar.unpacked");

/** Where chrome-headless-shell sits inside its Chrome for Testing archive on each platform MotionBrief ships for. */
const CHROME_HEADLESS_SHELL: Partial<Record<NodeJS.Platform, string>> = {
  win32: join("chrome-headless-shell-win64", "chrome-headless-shell.exe"),
  darwin: join("chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
};

/** The pinned chrome-headless-shell postinstall fetched into vendor/ (ADR 0002). */
export function chromeHeadlessShellPath(platform: NodeJS.Platform = process.platform): string {
  return join(ROOT, "vendor", "chrome-headless-shell", CHROME_HEADLESS_SHELL[platform] ?? "chrome-headless-shell");
}

export function ffmpegPath() {
  return join(ROOT, "vendor", "ffmpeg", executable("ffmpeg"));
}

export function ffprobePath() {
  return join(ROOT, "vendor", "ffmpeg", executable("ffprobe"));
}

export function whisperCliPath() {
  return join(ROOT, "vendor", "whisper-cli", executable("whisper-cli"));
}

/** The Silero model whisper-cli's VAD runs; postinstall saves it under a fixed name. */
export function whisperVadModelPath() {
  return join(ROOT, "vendor", "whisper-vad-model", "model.bin");
}

function executable(name: string) {
  if (process.platform === "win32") {
    return `${name}.exe`;
  }

  return name;
}
