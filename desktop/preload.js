'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dshDesktop', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  getState: () => ipcRenderer.invoke('server:state'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  start: (opts) => ipcRenderer.invoke('server:start', opts),
  stop: () => ipcRenderer.invoke('server:stop'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  openPath: (target) => ipcRenderer.invoke('shell:openPath', target),
  onLog: (cb) => ipcRenderer.on('server:log', (_e, line) => cb(line)),
  onStatus: (cb) => ipcRenderer.on('server:status', (_e, state) => cb(state)),
});
