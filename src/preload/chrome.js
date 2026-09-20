'use strict';
// Exposes window.ns to the chrome renderer (contextIsolation on).

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set([
  'nav:state', 'nav:progress', 'nav:status', 'nav:favicon', 'ui:command',
  'prefs:changed', 'download:update', 'find:result', 'history:changed', 'bookmarks:changed',
]);

contextBridge.exposeInMainWorld('ns', {
  platform: process.platform,
  windowId: ipcRenderer.sendSync('ns:window-id'),

  on(channel, handler) {
    if (!CHANNELS.has(channel)) return () => {};
    const fn = (e, payload) => handler(payload);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },

  command: (id, arg) => ipcRenderer.invoke('ns:command', { id, arg }),
  navigate: text => ipcRenderer.invoke('ns:navigate', text),
  setContentBounds: rect => ipcRenderer.invoke('ns:content-bounds', rect),
  setChromeMetrics: ({ top, bottom }) =>
    ipcRenderer.invoke('ns:content-bounds', {
      x: 0, y: Math.round(top),
      width: Math.round(window.innerWidth),
      height: Math.round(window.innerHeight - top - bottom),
    }),
  content: {
    freeze: () => ipcRenderer.invoke('ns:content-freeze'),
    setVisible: visible => ipcRenderer.invoke('ns:content-visible', visible),
  },

  prefs: {
    get: () => ipcRenderer.invoke('ns:prefs:get'),
    set: patch => ipcRenderer.invoke('ns:prefs:set', patch),
  },
  bookmarks: {
    list: () => ipcRenderer.invoke('ns:bookmarks:list'),
    add: b => ipcRenderer.invoke('ns:bookmarks:add', b),
    remove: id => ipcRenderer.invoke('ns:bookmarks:remove', id),
    update: (id, patch) => ipcRenderer.invoke('ns:bookmarks:update', { id, patch }),
  },
  history: {
    list: () => ipcRenderer.invoke('ns:history:list'),
    clear: () => ipcRenderer.invoke('ns:history:clear'),
  },

  find: (text, opts) => ipcRenderer.invoke('ns:find', { text, opts }),
  findStop: action => ipcRenderer.invoke('ns:find-stop', action),
  contextMenu: () => ipcRenderer.invoke('ns:context-menu'),

  win: {
    minimize: () => ipcRenderer.invoke('ns:win', 'minimize'),
    maximize: () => ipcRenderer.invoke('ns:win', 'maximize'),
    close: () => ipcRenderer.invoke('ns:win', 'close'),
    bounds: () => ipcRenderer.invoke('ns:win:bounds'),
    setBounds: rect => ipcRenderer.invoke('ns:win:set-bounds', rect),
    isMaximized: () => ipcRenderer.invoke('ns:win:is-maximized'),
  },

  dialog: {
    open: (name, params) => ipcRenderer.invoke('ns:dialog:open', { name, params }),
  },

  zoom: delta => ipcRenderer.invoke('ns:zoom', delta),
});
