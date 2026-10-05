/** One line on each bundled Style Preset for the picker's help text; the Presets themselves come from the core. */
const BUNDLED_BLURBS: Record<string, string> = {
  blueprint: "Technical diagrams on a navy grid",
  whiteboard: "Clean diagrams on a lined white board",
  sketchbook: "Hand-drawn shapes on warm paper",
  terminal: "Phosphor green on black, with scanlines",
};

export function presetBlurb(id: string) {
  return BUNDLED_BLURBS[id] ?? "Your own Style Preset";
}
