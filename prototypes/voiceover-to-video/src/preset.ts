// PROTOTYPE: the Style Preset from "Grilling: Style model" — Palette, typography, treatments, Motion,
// direction, allowed Transitions, Canvas preference, caption style — plus the four bundled Presets.
export const ROLES = ["bg", "bg2", "surface", "surface2", "line", "ink", "muted", "accent", "accent2", "accent3", "good", "bad"] as const;
export type Role = (typeof ROLES)[number];
export type Palette = { id: string; name: string; mode: "dark" | "light"; colors: Record<Role, string> };

export const PALETTES: Record<string, Palette> = {
  blueprint: {
    id: "blueprint", name: "Blueprint navy", mode: "dark",
    colors: { bg: "#070b14", bg2: "#0d1424", surface: "#111a2e", surface2: "#17223b", line: "#2a3a5c", ink: "#eef3fb", muted: "#93a1bd", accent: "#ff7a3d", accent2: "#38bdf8", accent3: "#a78bfa", good: "#22c55e", bad: "#f43f5e" },
  },
  whiteboard: {
    id: "whiteboard", name: "Whiteboard", mode: "light",
    colors: { bg: "#f7f8fa", bg2: "#eef1f6", surface: "#ffffff", surface2: "#f1f4f9", line: "#b9c3d3", ink: "#111827", muted: "#5b6678", accent: "#2563eb", accent2: "#0d9488", accent3: "#d97706", good: "#16a34a", bad: "#dc2626" },
  },
  paper: {
    id: "paper", name: "Sketch paper", mode: "light",
    colors: { bg: "#f6efe0", bg2: "#efe5cf", surface: "#fffaf0", surface2: "#f3e8d2", line: "#3b3024", ink: "#2b2118", muted: "#6f604f", accent: "#e0452b", accent2: "#2677b8", accent3: "#e9a90f", good: "#2f9a57", bad: "#c8372c" },
  },
  phosphor: {
    id: "phosphor", name: "Phosphor", mode: "dark",
    colors: { bg: "#040804", bg2: "#081208", surface: "#0a160b", surface2: "#0f2211", line: "#1f5a2a", ink: "#b8ffb2", muted: "#62b066", accent: "#ffb000", accent2: "#3ce8ff", accent3: "#ff5fd2", good: "#39ff6a", bad: "#ff4f4f" },
  },
  // alternates, used by the Palette swap test
  ember: {
    id: "ember", name: "Ember", mode: "dark",
    colors: { bg: "#120b0a", bg2: "#1d1210", surface: "#221614", surface2: "#2c1c19", line: "#4d3029", ink: "#fbefe9", muted: "#bfa197", accent: "#facc15", accent2: "#fb7185", accent3: "#f97316", good: "#4ade80", bad: "#ef4444" },
  },
  mint: {
    id: "mint", name: "Mint", mode: "light",
    colors: { bg: "#f2faf6", bg2: "#e3f4ec", surface: "#ffffff", surface2: "#eaf6f0", line: "#9fcbb6", ink: "#0f2a1f", muted: "#4d6b5e", accent: "#7c3aed", accent2: "#0891b2", accent3: "#db2777", good: "#15803d", bad: "#b91c1c" },
  },
};

export type Face = { family: string; weight: number; tracking?: string; scale?: number };
export type Typography = { id: string; name: string; display: Face; body: Face; label: Face; mono: Face };
// family -> [@fontsource package, weights we ship]
export const FONT_FILES: Record<string, [string, number[]]> = {
  Inter: ["inter", [400, 600, 800]],
  "JetBrains Mono": ["jetbrains-mono", [400, 700]],
  Manrope: ["manrope", [400, 600, 800]],
  "IBM Plex Mono": ["ibm-plex-mono", [400, 500, 700]],
  Fredoka: ["fredoka", [400, 600]],
  Nunito: ["nunito", [400, 700, 800]],
  VT323: ["vt323", [400]],
};
export const TYPOGRAPHY: Record<string, Typography> = {
  "inter-jbm": {
    id: "inter-jbm", name: "Inter + JetBrains Mono",
    display: { family: "Inter", weight: 800, tracking: "-0.03em" }, body: { family: "Inter", weight: 600 }, label: { family: "Inter", weight: 600 }, mono: { family: "JetBrains Mono", weight: 400 },
  },
  "manrope-plex": {
    id: "manrope-plex", name: "Manrope + IBM Plex Mono",
    display: { family: "Manrope", weight: 800, tracking: "-0.03em" }, body: { family: "Manrope", weight: 600 }, label: { family: "Manrope", weight: 600 }, mono: { family: "IBM Plex Mono", weight: 400 },
  },
  "fredoka-nunito": {
    id: "fredoka-nunito", name: "Fredoka + Nunito",
    display: { family: "Fredoka", weight: 600, tracking: "-0.01em" }, body: { family: "Nunito", weight: 700 }, label: { family: "Nunito", weight: 700 }, mono: { family: "JetBrains Mono", weight: 400 },
  },
  "vt323-plex": {
    id: "vt323-plex", name: "VT323 + IBM Plex Mono",
    display: { family: "VT323", weight: 400, tracking: "0.01em", scale: 1.3 }, body: { family: "IBM Plex Mono", weight: 500, scale: 0.88 }, label: { family: "IBM Plex Mono", weight: 500, scale: 0.88 }, mono: { family: "IBM Plex Mono", weight: 400 },
  },
};

export type Treatments = {
  surface: "flat" | "outlined" | "elevated";
  radius: number;
  background: "solid" | "gradient" | "dots" | "lines";
  connector: { curve: boolean; weight: number };
  line: "clean" | "sketchy";
  texture: "none" | "paper" | "grain" | "scanlines";
  icons: "outline" | "outline-chip" | "filled-chip";
};
export type Motion = { energy: "calm" | "balanced" | "punchy"; character: "smooth" | "springy" | "snappy" | "stepped" };
export const V1_TRANSITIONS = ["cut", "crossfade", "push", "zoom-through"] as const; // + camera (Canvas) and carry-over (unbuilt)

export type Preset = {
  id: string;
  name: string;
  palette: Palette; // copied values, never a link
  typography: string;
  treatments: Treatments;
  motion: Motion;
  direction: string;
  transitions: (typeof V1_TRANSITIONS)[number][];
  canvas: "never" | "helps" | "always";
  captions: "highlight" | "pop" | "plain";
};

const copy = (id: string): Palette => structuredClone(PALETTES[id]);

export const PRESETS: Record<string, Preset> = {
  blueprint: {
    id: "blueprint", name: "Blueprint", palette: copy("blueprint"), typography: "inter-jbm",
    treatments: { surface: "elevated", radius: 22, background: "dots", connector: { curve: false, weight: 4 }, line: "clean", texture: "none", icons: "outline" },
    motion: { energy: "balanced", character: "smooth" },
    direction: "ByteMonk-style system-design explainer: clean dark diagrams, icon+label nodes on cards, thin connectors that light up when data flows, one orange highlight for the key thing.",
    transitions: ["cut", "crossfade", "push", "zoom-through"], canvas: "helps", captions: "highlight",
  },
  whiteboard: {
    id: "whiteboard", name: "Whiteboard", palette: copy("whiteboard"), typography: "manrope-plex",
    treatments: { surface: "outlined", radius: 14, background: "lines", connector: { curve: true, weight: 3 }, line: "clean", texture: "none", icons: "outline-chip" },
    motion: { energy: "calm", character: "smooth" },
    direction: "Clean whiteboard explainer: dark ink on white, lots of whitespace, thin outlined boxes, one blue highlight. Calm and precise, like a senior engineer drawing on a board.",
    transitions: ["crossfade", "push"], canvas: "always", captions: "plain",
  },
  sketchbook: {
    id: "sketchbook", name: "Sketchbook", palette: copy("paper"), typography: "fredoka-nunito",
    treatments: { surface: "outlined", radius: 20, background: "solid", connector: { curve: true, weight: 5 }, line: "sketchy", texture: "paper", icons: "filled-chip" },
    motion: { energy: "punchy", character: "springy" },
    direction: "Cartoon sketchbook: bold dark hand-drawn outlines, flat bright fills, comic-panel feel, playful and friendly. Things pop in with a little bounce.",
    transitions: ["push", "zoom-through", "cut"], canvas: "helps", captions: "pop",
  },
  terminal: {
    id: "terminal", name: "Terminal", palette: copy("phosphor"), typography: "vt323-plex",
    treatments: { surface: "outlined", radius: 0, background: "solid", connector: { curve: false, weight: 3 }, line: "clean", texture: "scanlines", icons: "outline" },
    motion: { energy: "balanced", character: "stepped" },
    direction: "Old-school terminal / CRT: green phosphor text on black, boxes drawn like text-mode windows with square corners, a blinking-cursor feel, amber for the key thing. Things snap on rather than glide.",
    transitions: ["cut", "crossfade"], canvas: "never", captions: "plain",
  },
};

// ---------- Motion -> concrete helper defaults ----------
export type MotionSpec = { ease: string; easeInOut: string; dur: number; reveal: string; fps: number; durScale: number; rules: string };
export function motionSpec(m: Motion): MotionSpec {
  const durScale = { calm: 1.25, balanced: 1, punchy: 0.8 }[m.energy];
  const c = {
    smooth: { ease: "power3.out", easeInOut: "power2.inOut", dur: 0.5, reveal: "rise", fps: 0, rules: "Smooth long-tail easing (power3.out / power2.inOut). No bounce, no elastic, no back easing." },
    springy: { ease: "back.out(1.7)", easeInOut: "back.inOut(1.3)", dur: 0.55, reveal: "pop", fps: 0, rules: 'Springy: entrances overshoot a little and settle (back.out(1.4–2.0)); pops and scale-ins are welcome. No elastic wobble loops, no repeat/yoyo. Use the MB helpers\' default ease (already springy) unless you need something else.' },
    snappy: { ease: "expo.out", easeInOut: "expo.inOut", dur: 0.35, reveal: "rise", fps: 0, rules: "Snappy: short, decisive moves (expo.out, 0.25–0.4 s). No bounce, no slow fades." },
    stepped: { ease: "power2.out", easeInOut: "power2.inOut", dur: 0.4, reveal: "fade", fps: 12, rules: "Stepped: the frame plays your unit at 12 fps, so motion looks like a retro screen. Prefer things that snap on: fades, wipes, typing (MB.type), cursor-like reveals. Avoid long glides and big scale moves; keep durations short (0.2–0.4 s)." },
  }[m.character];
  return { ...c, dur: +(c.dur * durScale).toFixed(3), durScale };
}

// Scene length target within the Format's hard range, by energy
export function pacingFor(format: "horizontal" | "vertical", energy: Motion["energy"]) {
  const hard = format === "vertical" ? { minScene: 2.5, maxScene: 7 } : { minScene: 3, maxScene: 10 };
  const target = format === "vertical"
    ? { calm: [3.5, 7], balanced: [2.5, 6], punchy: [2.5, 5] }[energy]
    : { calm: [5, 10], balanced: [3, 8], punchy: [3, 6] }[energy];
  return { ...hard, target: target as [number, number] };
}

// ---------- contrast (the editor's warn/block rule) ----------
function lum(hex: string) {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
export function contrastReport(p: Palette) {
  const c = p.colors;
  const rows: { pair: string; ratio: number; need: number }[] = [];
  for (const fg of ["ink", "muted"] as const) for (const bg of ["bg", "surface"] as const) rows.push({ pair: `${fg} on ${bg}`, ratio: contrast(c[fg], c[bg]), need: 4.5 });
  for (const a of ["accent", "accent2", "accent3", "good", "bad"] as const) rows.push({ pair: `${a} on bg`, ratio: contrast(c[a], c.bg), need: 3 });
  return rows.map((r) => ({ ...r, ratio: +r.ratio.toFixed(2), ok: r.ratio >= r.need }));
}
