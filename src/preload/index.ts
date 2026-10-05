import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
import { CORE_PORT_MESSAGE, IPC, type AppCommand, type UpdateState } from "../shared/ipc";
import { toPlatform } from "../shared/shortcuts";
import type { Bridge } from "./bridge";

// MessagePorts can't cross the context bridge, so the renderer posts its core port to
// this window and the preload forwards it to main, which hands it to the core process.
window.addEventListener("message", (event) => {
  if (event.source !== window || event.data !== CORE_PORT_MESSAGE) {
    return;
  }

  ipcRenderer.postMessage(IPC.coreConnect, null, [...event.ports]);
});

function subscribe<T extends unknown[]>(channel: string, callback: (...args: T) => void) {
  const listener = (_event: IpcRendererEvent, ...args: unknown[]) => callback(...(args as T));
  ipcRenderer.on(channel, listener);

  return () => {
    ipcRenderer.off(channel, listener);
  };
}

const bridge: Bridge = {
  platform: toPlatform(process.platform),
  onCoreExited: (callback) => subscribe(IPC.coreExited, callback),
  onCoreRestarted: (callback) => subscribe(IPC.coreRestarted, callback),
  onCommand: (callback) => subscribe<[AppCommand]>(IPC.command, callback),
  showAppMenu: (position) => ipcRenderer.send(IPC.showAppMenu, position),
  showContextMenu: (items) => ipcRenderer.invoke(IPC.showContextMenu, items),
  chooseFile: (options) => ipcRenderer.invoke(IPC.chooseFile, options),
  chooseFolder: (title) => ipcRenderer.invoke(IPC.chooseFolder, title),
  showInFolder: (path) => ipcRenderer.send(IPC.showInFolder, path),
  pathForFile: (file) => webUtils.getPathForFile(file),
  chooseSavePath: (options) => ipcRenderer.invoke(IPC.chooseSavePath, options),
  getUpdateState: () => ipcRenderer.invoke(IPC.getUpdateState),
  onUpdateChanged: (callback) => subscribe<[UpdateState]>(IPC.updateChanged, callback),
  setUpdateChannel: (channel) => ipcRenderer.invoke(IPC.setUpdateChannel, channel),
  restartToUpdate: () => ipcRenderer.invoke(IPC.restartToUpdate),
};

contextBridge.exposeInMainWorld("motionbrief", bridge);
