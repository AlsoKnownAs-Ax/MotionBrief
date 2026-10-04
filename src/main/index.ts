/**
 * Main process: windows, menus, OS integration, the single-instance lock and the core
 * process lifecycle. Product logic lives in the core, never here.
 */
import { isAbsolute, join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { z } from "zod";
import coreEntry from "../core/index?modulePath";
import {
  EXPORTS_CHANNEL,
  IPC,
  type ChooseFileOptions,
  type ChooseSavePathOptions,
  type ContextMenuItem,
  type ExportsMessage,
  type MenuPosition,
} from "../shared/ipc";
import { handleConnectionStoreMessage } from "./connection-store";
import { startCoreProcess, type CoreProcess } from "./core-process";
import { installAppMenu } from "./menu";
import { startUpdater, type Updater } from "./updater";
import { createWindow } from "./window";

// IPC payloads come from the renderer, so they are checked before use.
const MenuPositionSchema = z.object({ x: z.number(), y: z.number() }) satisfies z.ZodType<MenuPosition>;
const ContextMenuItemsSchema = z.array(
  z.object({ id: z.string(), label: z.string(), enabled: z.boolean().optional() }),
) satisfies z.ZodType<ContextMenuItem[]>;
const ChooseFileOptionsSchema = z.object({
  title: z.string(),
  filters: z.array(z.object({ name: z.string(), extensions: z.array(z.string()) })),
}) satisfies z.ZodType<ChooseFileOptions>;
const ChooseSavePathOptionsSchema = ChooseFileOptionsSchema.extend({ defaultPath: z.string() }) satisfies z.ZodType<ChooseSavePathOptions>;
const UpdateChannelSchema = z.enum(["stable", "beta"]);
// Comes from the core process.
const ExportsMessageSchema = z.object({ channel: z.literal(EXPORTS_CHANNEL), running: z.number() }) satisfies z.ZodType<ExportsMessage>;

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

async function start() {
  const updater = await startUpdater({ onChange: (state) => broadcast(IPC.updateChanged, state) });
  const core = startCoreProcess({
    entry: coreEntry,
    appVersion: app.getVersion(),
    appDataDir: app.getPath("userData"),
    projectsDir: join(app.getPath("documents"), "MotionBrief"),
    cacheDir: cacheDir(),
    sampleDir: devOnly(join(app.getAppPath(), "src", "core", "fixtures")),
    onExit: () => {
      // Its exports died with it.
      updater.setRunningExports(0);
      broadcast(IPC.coreExited);
    },
    onRestart: () => broadcast(IPC.coreRestarted),
    onRequest: async (message) => {
      const { success, data: exports } = ExportsMessageSchema.safeParse(message);

      if (success) {
        updater.setRunningExports(exports.running);
        return undefined;
      }

      return handleConnectionStoreMessage(message);
    },
  });

  app.on("before-quit", () => core.stop());
  app.on("activate", focusOrCreateWindow);
  handleIpc(core);
  handleUpdateIpc(updater);
  installAppMenu({ newWindow: createWindow, crashCore: devOnly(() => core.crash()) });
  createWindow();
}

function handleIpc(core: CoreProcess) {
  ipcMain.on(IPC.coreConnect, (event) => {
    event.ports.forEach((port) => core.connect(port));
  });

  ipcMain.on(IPC.showAppMenu, (event, payload: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const { success, data: position } = MenuPositionSchema.safeParse(payload);

    if (!window || !success) {
      return;
    }

    Menu.getApplicationMenu()?.popup({ window, x: Math.round(position.x), y: Math.round(position.y) });
  });

  ipcMain.handle(IPC.showContextMenu, (event, payload: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const { success, data: items } = ContextMenuItemsSchema.safeParse(payload);

    if (!window || !success) {
      return null;
    }

    return popupContextMenu(window, items);
  });

  ipcMain.handle(IPC.chooseFile, async (event, payload: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const { success, data: options } = ChooseFileOptionsSchema.safeParse(payload);

    if (!window || !success) {
      return null;
    }

    const { canceled, filePaths } = await dialog.showOpenDialog(window, { ...options, properties: ["openFile"] });

    if (canceled) {
      return null;
    }

    return filePaths[0] ?? null;
  });

  ipcMain.handle(IPC.chooseSavePath, async (event, payload: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const { success, data: options } = ChooseSavePathOptionsSchema.safeParse(payload);

    if (!window || !success) {
      return null;
    }

    const defaultPath = isAbsolute(options.defaultPath) ? options.defaultPath : join(app.getPath("videos"), options.defaultPath);
    const { canceled, filePath } = await dialog.showSaveDialog(window, { ...options, defaultPath, properties: ["showOverwriteConfirmation", "createDirectory"] });

    if (canceled || !filePath) {
      return null;
    }

    return filePath;
  });

  ipcMain.on(IPC.showInFolder, (_event, payload: unknown) => {
    const { success, data: path } = z.string().safeParse(payload);

    if (success && isAbsolute(path)) {
      shell.showItemInFolder(path);
    }
  });
}

function handleUpdateIpc(updater: Updater) {
  ipcMain.handle(IPC.getUpdateState, () => updater.state());

  ipcMain.handle(IPC.setUpdateChannel, (_event, payload: unknown) => {
    const { success, data: channel } = UpdateChannelSchema.safeParse(payload);

    if (!success) {
      return updater.state();
    }

    return updater.setChannel(channel);
  });

  ipcMain.handle(IPC.restartToUpdate, () => updater.restart());
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

function broadcast(channel: string, ...args: unknown[]) {
  BrowserWindow.getAllWindows().forEach((window) => window.webContents.send(channel, ...args));
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

/** The OS's place for regenerable files: never roamed or backed up, unlike app data. */
function cacheDir() {
  if (process.platform === "darwin") {
    return join(app.getPath("home"), "Library", "Caches", "MotionBrief");
  }

  return join(process.env.LOCALAPPDATA ?? app.getPath("temp"), "MotionBrief", "Cache");
}

function devOnly<T>(value: T) {
  if (app.isPackaged) {
    return undefined;
  }

  return value;
}
