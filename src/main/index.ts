/**
 * Main process: windows, menus, OS integration, the single-instance lock and the core
 * process lifecycle. Product logic lives in the core, never here.
 */
import { app, BrowserWindow, ipcMain, Menu } from "electron";
import coreEntry from "../core/index?modulePath";
import { IPC, type ContextMenuItem } from "../shared/ipc";
import { startCoreProcess, type CoreProcess } from "./core-process";
import { installAppMenu } from "./menu";
import { createWindow } from "./window";

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", focusOrCreateWindow);
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
  void app.whenReady().then(start);
}

function start() {
  const core = startCoreProcess({
    entry: coreEntry,
    appVersion: app.getVersion(),
    onExit: () => broadcast(IPC.coreExited),
    onRestart: () => broadcast(IPC.coreRestarted),
  });

  app.on("before-quit", () => core.stop());
  app.on("activate", focusOrCreateWindow);
  handleIpc(core);
  installAppMenu({ newWindow: createWindow, crashCore: devOnly(() => core.crash()) });
  createWindow();
}

function handleIpc(core: CoreProcess) {
  ipcMain.on(IPC.coreConnect, (event) => {
    event.ports.forEach((port) => core.connect(port));
  });

  ipcMain.on(IPC.showAppMenu, (event, position: { x: number; y: number }) => {
    const window = BrowserWindow.fromWebContents(event.sender);

    if (!window) {
      return;
    }

    Menu.getApplicationMenu()?.popup({ window, x: Math.round(position.x), y: Math.round(position.y) });
  });

  ipcMain.handle(IPC.showContextMenu, (event, items: ContextMenuItem[]) => {
    const window = BrowserWindow.fromWebContents(event.sender);

    if (!window) {
      return null;
    }

    return popupContextMenu(window, items);
  });
}

/** Resolves to the chosen item's id, or null if the menu closed without a choice. */
function popupContextMenu(window: BrowserWindow, items: ContextMenuItem[]) {
  return new Promise<string | null>((resolve) => {
    const menu = Menu.buildFromTemplate(
      items.map(({ id, label, enabled }) => ({ label, enabled: enabled ?? true, click: () => resolve(id) })),
    );

    // The close callback can run before the click handler; give the click a turn to win.
    menu.popup({ window, callback: () => setImmediate(() => resolve(null)) });
  });
}

function broadcast(channel: string) {
  BrowserWindow.getAllWindows().forEach((window) => window.webContents.send(channel));
}

function focusOrCreateWindow() {
  const [window] = BrowserWindow.getAllWindows();

  if (!window) {
    createWindow();
    return;
  }

  if (window.isMinimized()) {
    window.restore();
  }

  window.focus();
}

function devOnly<T>(value: T) {
  if (app.isPackaged) {
    return undefined;
  }

  return value;
}
