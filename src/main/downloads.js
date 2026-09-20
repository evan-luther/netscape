'use strict';
// will-download -> save-as prompt -> tracked list broadcast to all chrome renderers.

const { app, session, dialog, BrowserWindow } = require('electron');
const path = require('path');

const items = []; // {id, filename, url, received, total, state}
const byId = new Map();
let seq = 0;
let wired = false;

function broadcast(entry) {
  const payload = {
    id: entry.id, filename: entry.filename, url: entry.url,
    received: entry.received, total: entry.total, state: entry.state,
  };
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('download:update', payload);
  }
}

function wire() {
  if (wired) return;
  wired = true;
  session.defaultSession.on('will-download', (event, item, wc) => {
    const win = BrowserWindow.fromWebContents(wc);
    const entry = {
      id: 'd' + (++seq),
      filename: item.getFilename(),
      url: item.getURL(),
      received: 0,
      total: item.getTotalBytes(),
      state: 'prompting',
      item,
    };
    items.unshift(entry);
    byId.set(entry.id, entry);

    item.once('done', (e, state) => {
      entry.state = state === 'completed' ? 'completed' : state; // 'interrupted' | 'cancelled'
      entry.received = item.getReceivedBytes();
      broadcast(entry);
    });
    item.on('updated', (e, state) => {
      entry.state = state === 'interrupted' ? 'interrupted' : 'progressing';
      entry.received = item.getReceivedBytes();
      entry.total = item.getTotalBytes();
      broadcast(entry);
    });

    dialog.showSaveDialog(win || undefined, {
      defaultPath: path.join(app.getPath('downloads'), item.getFilename()),
    }).then(res => {
      if (res.canceled || !res.filePath) {
        entry.state = 'cancelled';
        item.cancel();
        broadcast(entry);
        return;
      }
      entry.filename = res.filePath;
      entry.state = 'progressing';
      item.setSavePath(res.filePath);
      broadcast(entry);
    }).catch(() => {
      entry.state = 'cancelled';
      item.cancel();
      broadcast(entry);
    });
  });
}

module.exports = {
  wire,
  list() {
    return items.map(({ id, filename, url, received, total, state }) =>
      ({ id, filename, url, received, total, state }));
  },
  cancel(id) {
    const e = byId.get(id);
    if (e && e.item && (e.state === 'progressing' || e.state === 'prompting')) {
      e.state = 'cancelled';
      e.item.cancel();
      broadcast(e);
    }
  },
};
