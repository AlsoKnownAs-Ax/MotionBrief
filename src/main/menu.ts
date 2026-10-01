import { app, BrowserWindow, dialog, Menu, shell, type MenuItemConstructorOptions } from "electron";
import { IPC, type AppCommand } from "../shared/ipc";
import { acceleratorFor, SHORTCUTS, type Platform, type Shortcut } from "../shared/shortcuts";

const REPOSITORY_URL = "https://github.com/AlsoKnownAs-Ax/MotionBrief";

type AppMenuActions = {
  newWindow: () => void;
  /** Present only in development builds. */
  crashCore?: () => void;
};

const isMac = process.platform === "darwin";

function accelerator(shortcut: Shortcut) {
  return acceleratorFor(shortcut, process.platform as Platform);
}

function sendCommand(command: AppCommand) {
  BrowserWindow.getFocusedWindow()?.webContents.send(IPC.command, command);
}

function showAbout() {
  if (isMac) {
    app.showAboutPanel();
    return;
  }

  const window = BrowserWindow.getFocusedWindow();
  const options = {
    type: "none" as const,
    title: "About MotionBrief",
    message: "MotionBrief",
    detail: `Version ${app.getVersion()}\nMIT License`,
  };

  if (window) {
    void dialog.showMessageBox(window, options);
    return;
  }

  void dialog.showMessageBox(options);
}

function macAppMenu(): MenuItemConstructorOptions[] {
  if (!isMac) {
    return [];
  }

  return [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
  ];
}

function quitItems(): MenuItemConstructorOptions[] {
  if (isMac) {
    return [];
  }

  return [{ type: "separator" }, { role: "quit", label: "Exit" }];
}

function windowMenu(): MenuItemConstructorOptions[] {
  if (!isMac) {
    return [];
  }

  return [{ role: "windowMenu" }];
}

function aboutItems(): MenuItemConstructorOptions[] {
  if (isMac) {
    return [];
  }

  return [{ type: "separator" }, { label: "About MotionBrief", click: showAbout }];
}

function developerMenu({ crashCore }: AppMenuActions): MenuItemConstructorOptions[] {
  if (!crashCore) {
    return [];
  }

  return [
    {
      label: "Developer",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { label: "Crash Core Process", click: crashCore },
      ],
    },
  ];
}

export function installAppMenu(actions: AppMenuActions) {
  const template: MenuItemConstructorOptions[] = [
    ...macAppMenu(),
    {
      label: "File",
      submenu: [
        { label: "New Window", accelerator: accelerator(SHORTCUTS.newWindow), click: actions.newWindow },
        { type: "separator" },
        { role: "close", accelerator: accelerator(SHORTCUTS.closeWindow) },
        ...quitItems(),
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "resetZoom", accelerator: accelerator(SHORTCUTS.resetZoom) },
        { role: "zoomIn", accelerator: accelerator(SHORTCUTS.zoomIn) },
        { role: "zoomOut", accelerator: accelerator(SHORTCUTS.zoomOut) },
        { type: "separator" },
        { role: "togglefullscreen", accelerator: accelerator(SHORTCUTS.toggleFullScreen) },
      ],
    },
    ...windowMenu(),
    ...developerMenu(actions),
    {
      role: "help",
      submenu: [
        {
          label: "Keyboard Shortcuts",
          accelerator: accelerator(SHORTCUTS.showShortcuts),
          click: () => sendCommand("shortcuts.show"),
        },
        { label: "MotionBrief on GitHub", click: () => void shell.openExternal(REPOSITORY_URL) },
        ...aboutItems(),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
