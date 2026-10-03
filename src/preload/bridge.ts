import type { AppCommand, ChooseFileOptions, ContextMenuItem, MenuPosition } from "../shared/ipc";
import type { Platform } from "../shared/shortcuts";

/** What the preload exposes to the renderer as `window.motionbrief`. */
export type Bridge = {
  platform: Platform;
  onCoreExited: (callback: () => void) => () => void;
  onCoreRestarted: (callback: () => void) => () => void;
  onCommand: (callback: (command: AppCommand) => void) => () => void;
  showAppMenu: (position: MenuPosition) => void;
  showContextMenu: (items: ContextMenuItem[]) => Promise<string | null>;
  /** The native open-file dialog; resolves to the chosen file's path, or null when cancelled. */
  chooseFile: (options: ChooseFileOptions) => Promise<string | null>;
};
