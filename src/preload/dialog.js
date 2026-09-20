'use strict';
// Exposes window.nsd to frameless dialog windows (contextIsolation on).

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set([
  'nav:state', 'nav:progress', 'nav:status', 'nav:favicon', 'ui:command',
  'prefs:changed', 'download:update', 'find:result', 'history:changed', 'bookmarks:changed',
  'dialog:params',
]);

const name = (process.argv.find(a => a.startsWith('--ns-dialog=')) || '').split('=')[1] || '';

contextBridge.exposeInMainWorld('nsd', {
  platform: process.platform,
  name,

  params: () => ipcRenderer.invoke('nsd:params'),

  on(channel, handler) {
    if (!CHANNELS.has(channel)) return () => {};
    const fn = (e, payload) => handler(payload);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },

  command: (id, arg) => ipcRenderer.invoke('ns:command', { id, arg }),
  close: result => ipcRenderer.invoke('nsd:close', result),
  pick: kind => ipcRenderer.invoke('nsd:pick', kind),

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

  win: {
    minimize: () => ipcRenderer.invoke('ns:win', 'minimize'),
    maximize: () => ipcRenderer.invoke('ns:win', 'maximize'),
    close: () => ipcRenderer.invoke('ns:win', 'close'),
  },
});
