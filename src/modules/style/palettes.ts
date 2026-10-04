import type { Palette } from "../../contract";

/**
 * The bundled Palettes a Style Preset copies its colors from. The first four belong to the bundled
 * Presets; Ember and Mint are alternates for a Palette swap. Values come from the Style Preset spike.
 */
export const BLUEPRINT_NAVY: Palette = {
  name: "Blueprint navy",
  mode: "dark",
  colors: {
    bg: "#070b14",
    bg2: "#0d1424",
    surface: "#111a2e",
    surface2: "#17223b",
    line: "#2a3a5c",
    ink: "#eef3fb",
    muted: "#93a1bd",
    accent: "#ff7a3d",
    accent2: "#38bdf8",
    accent3: "#a78bfa",
    good: "#22c55e",
    bad: "#f43f5e",
  },
};

export const WHITEBOARD: Palette = {
  name: "Whiteboard",
  mode: "light",
  colors: {
    bg: "#f7f8fa",
    bg2: "#eef1f6",
    surface: "#ffffff",
    surface2: "#f1f4f9",
    line: "#b9c3d3",
    ink: "#111827",
    muted: "#5b6678",
    accent: "#2563eb",
    accent2: "#0d9488",
    accent3: "#d97706",
    good: "#16a34a",
    bad: "#dc2626",
  },
};

export const SKETCH_PAPER: Palette = {
  name: "Sketch paper",
  mode: "light",
  colors: {
    bg: "#f6efe0",
    bg2: "#efe5cf",
    surface: "#fffaf0",
    surface2: "#f3e8d2",
    line: "#3b3024",
    ink: "#2b2118",
    muted: "#6f604f",
    accent: "#e0452b",
    accent2: "#2677b8",
    accent3: "#e9a90f",
    good: "#2f9a57",
    bad: "#c8372c",
  },
};

export const PHOSPHOR: Palette = {
  name: "Phosphor",
  mode: "dark",
  colors: {
    bg: "#040804",
    bg2: "#081208",
    surface: "#0a160b",
    surface2: "#0f2211",
    line: "#1f5a2a",
    ink: "#b8ffb2",
    muted: "#62b066",
    accent: "#ffb000",
    accent2: "#3ce8ff",
    accent3: "#ff5fd2",
    good: "#39ff6a",
    bad: "#ff4f4f",
  },
};

const EMBER: Palette = {
  name: "Ember",
  mode: "dark",
  colors: {
    bg: "#120b0a",
    bg2: "#1d1210",
    surface: "#221614",
    surface2: "#2c1c19",
    line: "#4d3029",
    ink: "#fbefe9",
    muted: "#bfa197",
    accent: "#facc15",
    accent2: "#fb7185",
    accent3: "#f97316",
    good: "#4ade80",
    bad: "#ef4444",
  },
};

const MINT: Palette = {
  name: "Mint",
  mode: "light",
  colors: {
    bg: "#f2faf6",
    bg2: "#e3f4ec",
    surface: "#ffffff",
    surface2: "#eaf6f0",
    line: "#9fcbb6",
    ink: "#0f2a1f",
    muted: "#4d6b5e",
    accent: "#7c3aed",
    accent2: "#0891b2",
    accent3: "#db2777",
    good: "#15803d",
    bad: "#b91c1c",
  },
};

export const BUNDLED_PALETTES: readonly Palette[] = [BLUEPRINT_NAVY, WHITEBOARD, SKETCH_PAPER, PHOSPHOR, EMBER, MINT];
