import type { AppCommand, ChooseFileOptions, ChooseSavePathOptions, ContextMenuItem, MenuPosition } from "../shared/ipc";
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
  /** The native choose-folder dialog; resolves to the chosen folder's path, or null when cancelled. */
  chooseFolder: (title: string) => Promise<string | null>;
  /** Reveals a file in Explorer or Finder. */
  showInFolder: (path: string) => void;
  /** The path of a file dropped on the window; empty for anything that isn't a file on disk. */
  pathForFile: (file: File) => string;
  /** The native Save dialog; resolves to the chosen path, or null when cancelled. */
  chooseSavePath: (options: ChooseSavePathOptions) => Promise<string | null>;
};
