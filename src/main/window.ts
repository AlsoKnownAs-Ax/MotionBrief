import { join } from "node:path";
import {
  BrowserWindow,
  Menu,
  shell,
  type BrowserWindowConstructorOptions,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
} from "electron";
import { MIN_WINDOW_SIZE, TITLE_BAR_HEIGHT, WINDOW_COLORS } from "../shared/window";

const RENDERER_DEV_URL = process.env["ELECTRON_RENDERER_URL"];

/** Hides the native title bar but keeps native window controls: traffic lights on macOS, a caption overlay elsewhere. */
function titleBarOptions(): BrowserWindowConstructorOptions {
  if (process.platform === "darwin") {
    return { titleBarStyle: "hidden", trafficLightPosition: { x: 18, y: (TITLE_BAR_HEIGHT - 14) / 2 } };
  }

  return {
    titleBarStyle: "hidden",
    titleBarOverlay: { color: WINDOW_COLORS.canvas, symbolColor: WINDOW_COLORS.ink, height: TITLE_BAR_HEIGHT },
  };
}

export function createWindow() {
  const window = new BrowserWindow({
    title: "MotionBrief",
    width: 1280,
    height: 800,
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
    show: false,
    backgroundColor: WINDOW_COLORS.canvas,
    ...titleBarOptions(),
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.once("ready-to-show", () => window.show());
  lockNavigation(window);
  window.webContents.on("context-menu", (_event, params) => showEditContextMenu(window, params));
  loadRenderer(window);

  return window;
}

/** The Vite dev server in development, the built files otherwise. */
function loadRenderer(window: BrowserWindow) {
  if (RENDERER_DEV_URL) {
    void window.loadURL(RENDERER_DEV_URL);
    return;
  }

  void window.loadFile(join(import.meta.dirname, "../renderer/index.html"));
}

/** The window only ever shows the app; links open in the user's browser. */
function lockNavigation(window: BrowserWindow) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) {
      void shell.openExternal(url);
    }

    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
}

/** Cut / Copy / Paste on text fields and selections. Renderer-owned menus call preventDefault and never reach this. */
function showEditContextMenu(window: BrowserWindow, params: ContextMenuParams) {
  if (!params.isEditable && !params.selectionText) {
    return;
  }

  Menu.buildFromTemplate(editMenuItems(params)).popup({ window });
}

function editMenuItems({ isEditable, editFlags }: ContextMenuParams): MenuItemConstructorOptions[] {
  if (!isEditable) {
    return [{ role: "copy", enabled: editFlags.canCopy }];
  }

  return [
    { role: "cut", enabled: editFlags.canCut },
    { role: "copy", enabled: editFlags.canCopy },
    { role: "paste", enabled: editFlags.canPaste },
    { type: "separator" },
    { role: "selectAll", enabled: editFlags.canSelectAll },
  ];
}
