/** A bundled Style Preset as the picker shows it, with the Palette colors its card is drawn in. */
export type PresetChoice = {
  id: string;
  name: string;
  blurb: string;
  colors: { bg: string; surface: string; line: string; ink: string; accent: string; accent2: string };
};

/** The four bundled Style Presets. Rendered previews replace these cards once the Preset editor lands. */
export const BUNDLED_PRESETS: PresetChoice[] = [
  {
    id: "blueprint",
    name: "Blueprint",
    blurb: "Technical diagrams on a navy grid",
    colors: { bg: "#070b14", surface: "#111a2e", line: "#2a3a5c", ink: "#eef3fb", accent: "#ff7a3d", accent2: "#38bdf8" },
  },
  {
    id: "whiteboard",
    name: "Whiteboard",
    blurb: "Clean diagrams on a lined white board",
    colors: { bg: "#f7f8fa", surface: "#ffffff", line: "#b9c3d3", ink: "#111827", accent: "#2563eb", accent2: "#0d9488" },
  },
  {
    id: "sketchbook",
    name: "Sketchbook",
    blurb: "Hand-drawn shapes on warm paper",
    colors: { bg: "#f6efe0", surface: "#fffaf0", line: "#3b3024", ink: "#2b2118", accent: "#e0452b", accent2: "#2677b8" },
  },
  {
    id: "terminal",
    name: "Terminal",
    blurb: "Phosphor green on black, with scanlines",
    colors: { bg: "#040804", surface: "#0a160b", line: "#1f5a2a", ink: "#b8ffb2", accent: "#ffb000", accent2: "#3ce8ff" },
  },
];
