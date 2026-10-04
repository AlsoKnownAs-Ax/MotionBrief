/** IPC between main, preload and renderer. Core API traffic never uses these; it goes over the core MessagePort. */
export const IPC = {
  /** renderer → main: carries the core-side MessagePort, which main hands to the core process. */
  coreConnect: "core:connect",
  /** main → renderer: the core process exited and is being restarted. */
  coreExited: "core:exited",
  /** main → renderer: a new core process is up; reconnect. */
  coreRestarted: "core:restarted",
  /** main → renderer: an app-menu item the renderer handles was chosen. */
  command: "app:command",
  /** renderer → main: pop up the app menu (Windows has no visible menu bar). */
  showAppMenu: "menu:show-app",
  /** renderer → main (invoke): pop up a context menu, resolving to the chosen item id or null. */
  showContextMenu: "menu:show-context",
  /** renderer → main (invoke): show the native open-file dialog, resolving to the chosen path or null. */
  chooseFile: "dialog:choose-file",
} as const;

/** window.postMessage tag the renderer uses to hand its core port to the preload. */
export const CORE_PORT_MESSAGE = "motionbrief:core-port";

/** Command-line flag main passes the app version to the core process with. */
export const CORE_APP_VERSION_FLAG = "--app-version=";

/** Command-line flag main passes the app's per-user data folder to the core process with. */
export const CORE_APP_DATA_FLAG = "--app-data=";

/**
 * core → main over the core's parent port: the Claude connection, which main keeps with
 * Electron safeStorage (the OS keychain), since the core can't use Electron. Main answers
 * each request with a response carrying the same id.
 */
export const CONNECTION_STORE_CHANNEL = "connection-store";

export type StoredConnectionMessage = {
  method?: "subscription" | "api-key";
  apiKey?: string;
};

export type ConnectionStoreRequest = {
  channel: typeof CONNECTION_STORE_CHANNEL;
  id: number;
  /** Absent to load, present to save. */
  save?: StoredConnectionMessage;
};

export type ConnectionStoreResponse = {
  channel: typeof CONNECTION_STORE_CHANNEL;
  id: number;
  connection?: StoredConnectionMessage;
  error?: string;
};

/** Commands the app menu sends to the focused window. */
export type AppCommand = "shortcuts.show" | "settings.show";

/** Where to pop up a menu, in window coordinates. */
export type MenuPosition = {
  x: number;
  y: number;
};

export type ContextMenuItem = {
  id: string;
  label: string;
  enabled?: boolean;
};

/** What the native open-file dialog asks for. */
export type ChooseFileOptions = {
  title: string;
  filters: { name: string; extensions: string[] }[];
};
