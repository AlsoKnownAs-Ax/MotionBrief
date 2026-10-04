import { join } from "node:path";

/** The repo root in development: this file runs from src/core in tests and from out/core when built. */
const ROOT = join(import.meta.dirname, "..", "..");

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

function executable(name: string) {
  if (process.platform === "win32") {
    return `${name}.exe`;
  }

  return name;
}
