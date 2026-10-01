import type { AppCommand, ContextMenuItem } from "../shared/ipc";
import type { Platform } from "../shared/shortcuts";

/** What the preload exposes to the renderer as `window.motionbrief`. */
export type Bridge = {
  platform: Platform;
  onCoreExited: (callback: () => void) => () => void;
  onCoreRestarted: (callback: () => void) => () => void;
  onCommand: (callback: (command: AppCommand) => void) => () => void;
  showAppMenu: (position: { x: number; y: number }) => void;
  showContextMenu: (items: ContextMenuItem[]) => Promise<string | null>;
};
