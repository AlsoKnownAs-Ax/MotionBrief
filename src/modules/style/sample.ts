import type { StylePreset, VideoSource } from "../../contract";
import { storyboardRules } from "./rules";

/** What a Preset's sample is drawn from, and the moment of it to show. */
export type PresetSample = { source: VideoSource; time: number };

/** The words end at 3.35 s; the rest gives the last element time to settle, whatever the Motion. */
const TRANSCRIPT = {
  duration: 5,
  words: [
    { text: "Your", start: 0.3 },
    { text: "browser", start: 0.55 },
    { text: "asks", start: 1.0 },
    { text: "a", start: 1.3 },
    { text: "server,", start: 1.45 },
    { text: "and", start: 2.1 },
    { text: "the", start: 2.3 },
    { text: "server", start: 2.45 },
    { text: "asks", start: 2.9 },
    { text: "the", start: 3.2 },
    { text: "database.", start: 3.35 },
  ],
};

const STORYBOARD = {
  format: "horizontal",
  scenes: [
    {
      id: "s01",
      type: "architecture-diagram",
      from: 0,
      to: 10,
      content: {
        nodes: [
          { id: "browser", label: "Browser", icon: "lucide:laptop", at: 1 },
          { id: "server", label: "Server", icon: "lucide:server", at: 4 },
        ],
        edges: [{ id: "browser-server", from: "browser", to: "server", at: 4 }],
      },
    },
  ],
};

/**
 * Token-only Scene code, as the agent writes it: a title, two cards with icons, one accented, and a connector.
 * Drawn large, since the still is shown a few hundred pixels wide.
 */
const CODE = {
  css: `.ps-wrap { display: flex; flex-direction: column; justify-content: center; gap: 96px; }
.ps-diagram { position: relative; display: flex; align-items: center; justify-content: space-between; }
.ps-node { display: flex; align-items: center; gap: 36px; padding: 44px 64px; }
.ps-node .mb-body { font-size: 80px; }
.ps-icon { font-size: 112px; color: var(--accent2); }
.ps-key .ps-icon { color: var(--accent); }`,
  html: `<div class="mb-safe ps-wrap">
  <div class="mb-display">One round trip</div>
  <div class="ps-diagram">
    <svg class="mb-wire"><path id="s01-browser-server"></path></svg>
    <div id="s01-browser" class="mb-card ps-node"><i data-icon="lucide:laptop" class="ps-icon"></i><span class="mb-body">Browser</span></div>
    <div id="s01-server" class="mb-card ps-node ps-key"><i data-icon="lucide:server" class="ps-icon"></i><span class="mb-body">Server</span></div>
  </div>
</div>`,
  js: `MB.connect("#s01-browser-server", "#s01-browser", "#s01-server");
MB.reveal(tl, "#s01-browser", at("s01-browser"));
MB.reveal(tl, "#s01-server", at("s01-server"));
MB.draw(tl, "#s01-browser-server", at("s01-browser-server"));`,
};

/** A one-Scene diagram in the Preset, horizontal and without Captions, shown once every element is in. */
export function presetSample(preset: StylePreset): PresetSample {
  return {
    source: {
      storyboard: STORYBOARD,
      transcript: TRANSCRIPT,
      rules: storyboardRules(preset, { format: "horizontal", captions: false }),
      preset,
      code: { s01: CODE },
    },
    time: TRANSCRIPT.duration - 0.15,
  };
}
