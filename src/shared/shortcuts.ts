/**
 * App keyboard shortcuts. The app menu binds these accelerators and the Keyboard
 * Shortcuts dialog lists them, so the two can't drift apart.
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

export type Platform = "darwin" | "win32" | "linux";

export function acceleratorFor(shortcut: Shortcut, platform: Platform) {
  if (platform === "darwin") {
    return shortcut.macAccelerator ?? shortcut.accelerator;
  }

  return shortcut.accelerator;
}

const MAC_KEY_LABELS: Record<string, string> = {
  CmdOrCtrl: "⌘",
  Cmd: "⌘",
  Command: "⌘",
  Ctrl: "⌃",
  Control: "⌃",
  Shift: "⇧",
  Alt: "⌥",
  Option: "⌥",
};

const OTHER_KEY_LABELS: Record<string, string> = {
  CmdOrCtrl: "Ctrl",
  Control: "Ctrl",
};

function keyLabelsFor(platform: Platform) {
  if (platform === "darwin") {
    return MAC_KEY_LABELS;
  }

  return OTHER_KEY_LABELS;
}

/** Splits an accelerator into the key labels shown to the user on `platform`. */
export function acceleratorKeys(accelerator: string, platform: Platform) {
  const labels = keyLabelsFor(platform);

  return accelerator.split("+").map((key) => labels[key] ?? key);
}
