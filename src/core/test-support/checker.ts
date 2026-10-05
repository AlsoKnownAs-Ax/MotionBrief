import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRouterClient } from "@orpc/server";
import type { StoryboardRules } from "../../contract";
import { bundledPreset } from "../../modules/style";
import { createCore, type CoreOptions } from "../composition-root";

/** The default Style Preset, which the Checker's fixtures are written for. */
export const BLUEPRINT = bundledPreset("blueprint");

/** A Blueprint-like horizontal video: every Transition kind allowed, Canvases where they help, no Captions. */
export const RULES: StoryboardRules = {
  format: "horizontal",
  captions: false,
  transitions: ["cut", "crossfade", "push", "zoom-through", "carry-over", "camera"],
  canvas: "where-it-helps",
};

/** Each check runs `hyperframes check` and the contract probe in the pinned chrome-headless-shell. */
export const BROWSER_TIMEOUT_MS = 90_000;

export function connect(options: Partial<CoreOptions> = {}) {
  const { router } = createCore({ appVersion: "1.2.3", appDataDir: join(tmpdir(), "motionbrief-checker-test"), ...options });

  return createRouterClient(router);
}
