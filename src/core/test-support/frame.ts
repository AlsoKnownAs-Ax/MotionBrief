import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StoryboardTranscript, StylePreset, UnitCode } from "../../contract";
import { assemble } from "../../modules/assembler";
import { openFramePage, type FramePage } from "../../modules/checker";
import type { Storyboard } from "../../modules/storyboard";
import { chromeHeadlessShellPath } from "../native";

/** Opening a page launches the pinned chrome-headless-shell. */
export const FRAME_TIMEOUT_MS = 60_000;

/** Closing a page waits for the browser to exit, which can take seconds while other test files load the machine. */
export const CLOSE_TIMEOUT_MS = 30_000;

export type OpenFrame = { page: FramePage; dir: string };

/**
 * Assembles a Storyboard's units in the frame, in a Style Preset, and opens the page; units without code are
 * fallback Scenes. Captions are off unless asked for.
 */
export async function openFrame(
  storyboard: Storyboard,
  transcript: StoryboardTranscript,
  code: Record<string, UnitCode>,
  preset: StylePreset,
  { captions = false }: { captions?: boolean } = {},
): Promise<OpenFrame> {
  const dir = await mkdtemp(join(tmpdir(), "motionbrief-frame-"));
  const { width, height } = await assemble({ dir, storyboard, transcript, preset, code, captions });
  const { data: page, error } = await openFramePage({ dir, chromePath: chromeHeadlessShellPath(), width, height });

  if (error) {
    throw new Error(error.message);
  }

  return { page, dir };
}

export async function closeFrame(frame: OpenFrame | undefined) {
  await frame?.page.close();

  if (frame) {
    await rm(frame.dir, { recursive: true, force: true });
  }
}
