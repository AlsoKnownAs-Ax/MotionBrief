/**
 * App keyboard shortcuts. The app menu binds these accelerators and the Keyboard
 * Shortcuts dialog lists them, so the keys can't drift apart.
 */

export type Shortcut = {
  label: string;
  /** Electron accelerator syntax. */
  accelerator: string;
  /** Overrides `accelerator` on macOS. */
  macAccelerator?: string;
};

export const SHORTCUTS = {
  newWindow: { label: "New window", accelerator: "CmdOrCtrl+Shift+N" },
  closeWindow: { label: "Close window", accelerator: "CmdOrCtrl+W" },
  showShortcuts: { label: "Keyboard shortcuts", accelerator: "CmdOrCtrl+/" },
  toggleFullScreen: { label: "Toggle full screen", accelerator: "F11", macAccelerator: "Ctrl+Cmd+F" },
  zoomIn: { label: "Zoom in", accelerator: "CmdOrCtrl+=" },
  zoomOut: { label: "Zoom out", accelerator: "CmdOrCtrl+-" },
  resetZoom: { label: "Actual size", accelerator: "CmdOrCtrl+0" },
} satisfies Record<string, Shortcut>;

/** The platforms MotionBrief ships on, plus Linux for contributors. */
export type Platform = "darwin" | "win32" | "linux";

export function toPlatform(nodePlatform: string): Platform {
  if (nodePlatform === "darwin" || nodePlatform === "win32") {
    return nodePlatform;
  }

  return "linux";
}

export function acceleratorFor(shortcut: Shortcut, platform: Platform) {
  if (platform === "darwin") {
    return shortcut.macAccelerator ?? shortcut.accelerator;
  }

  return shortcut.accelerator;
}

const PC_KEY_LABELS: Record<string, string> = {
  CmdOrCtrl: "Ctrl",
  Control: "Ctrl",
};

const KEY_LABELS = {
  darwin: {
    CmdOrCtrl: "⌘",
    Cmd: "⌘",
    Command: "⌘",
    Ctrl: "⌃",
    Control: "⌃",
    Shift: "⇧",
    Alt: "⌥",
    Option: "⌥",
  },
  win32: PC_KEY_LABELS,
  linux: PC_KEY_LABELS,
} satisfies Record<Platform, Record<string, string>>;

/** The key labels to show for `shortcut` on `platform`, in order. */
export function shortcutKeys(shortcut: Shortcut, platform: Platform) {
  const labels: Record<string, string> = KEY_LABELS[platform];

  return acceleratorFor(shortcut, platform)
    .split("+")
    .map((key) => labels[key] ?? key);
}
