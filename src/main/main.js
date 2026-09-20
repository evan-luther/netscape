'use strict';
// Entry point: lifecycle, single instance, IPC surface backing window.ns / window.nsd.

const { app, ipcMain, dialog, BrowserWindow } = require('electron');
const store = require('./store');
const menu = require('./menu');
const commands = require('./commands');
const downloads = require('./downloads');
const { NavigatorWindow } = require('./window');

// Resolve the NavigatorWindow that owns an IPC sender (chrome, content, or dialog).
function ownerWin(e) {
  return NavigatorWindow.fromWebContents(e.sender);
}

function broadcast(channel, payload) {
  for (const nav of NavigatorWindow.all) nav._send(channel, payload);
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && !w.webContents.isDestroyed() && NavigatorWindow.dialogFor(w.webContents)) {
      w.webContents.send(channel, payload); // dialog windows get store events too
    }
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const nav = NavigatorWindow.focused() || [...NavigatorWindow.all][0];
    if (nav && !nav.win.isDestroyed()) {
      if (nav.win.isMinimized()) nav.win.restore();
      nav.win.focus();
    } else {
      new NavigatorWindow();
    }
  });

  app.whenReady().then(() => {
    downloads.wire();

    // Store events -> all renderers + menu refresh.
    store.on('prefs', () => broadcast('prefs:changed', { prefs: store.prefs() }));
    store.on('bookmarks', () => {
      broadcast('bookmarks:changed', { count: store.bookmarks().length });
      menu.rebuild();
    });
    store.on('history', () => broadcast('history:changed', { count: store.history().length }));

    NavigatorWindow.onNavigate(() => menu.rebuild());
    NavigatorWindow.onFocus(() => menu.rebuild());

    menu.rebuild();
    new NavigatorWindow();
  });

  app.on('activate', () => {
    if (NavigatorWindow.all.size === 0) new NavigatorWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

// ---- window.ns surface ----------------------------------------------------

ipcMain.on('ns:window-id', e => { e.returnValue = e.sender.id; });

ipcMain.handle('ns:command', (e, { id, arg }) => commands.run(id, ownerWin(e), arg));

ipcMain.handle('ns:navigate', (e, text) => {
  const nav = ownerWin(e);
  if (!nav) return null;
  const t = commands.resolveTarget(text);
  if (t) nav.navigate(t.url, t.autoScheme);
  return t;
});

ipcMain.handle('ns:content-bounds', (e, rect) => {
  const nav = ownerWin(e);
  if (nav && rect) nav.setContentBounds(rect);
});

ipcMain.handle('ns:content-freeze', (e) => {
  const nav = ownerWin(e);
  return nav ? nav.freezeContent() : null;
});

ipcMain.handle('ns:content-visible', (e, visible) => {
  const nav = ownerWin(e);
  if (nav) nav.setContentVisible(visible);
});

ipcMain.handle('ns:prefs:get', () => store.prefs());
ipcMain.handle('ns:prefs:set', (e, patch) => store.setPrefs(patch));

ipcMain.handle('ns:bookmarks:list', () => store.bookmarks());
ipcMain.handle('ns:bookmarks:add', (e, b) => store.addBookmark(b));
ipcMain.handle('ns:bookmarks:remove', (e, id) => store.removeBookmark(id));
ipcMain.handle('ns:bookmarks:update', (e, { id, patch }) => store.updateBookmark(id, patch));

ipcMain.handle('ns:history:list', () => store.history());
ipcMain.handle('ns:history:clear', () => store.clearHistory());

ipcMain.handle('ns:find', (e, { text, opts }) => {
  const nav = ownerWin(e);
  if (nav) nav.find(text, opts);
});
ipcMain.handle('ns:find-stop', (e, action) => {
  const nav = ownerWin(e);
  if (nav) nav.findStop(action);
});

ipcMain.handle('ns:context-menu', e => {
  const nav = ownerWin(e);
  if (nav) nav.showContextMenu({});
});

ipcMain.handle('ns:win', (e, action) => {
  const bw = BrowserWindow.fromWebContents(e.sender);
  if (!bw || bw.isDestroyed()) return;
  if (action === 'minimize') bw.minimize();
  else if (action === 'maximize') { if (bw.isMaximized()) bw.unmaximize(); else bw.maximize(); }
  else if (action === 'close') bw.close();
});

ipcMain.handle('ns:win:bounds', e => {
  const bw = BrowserWindow.fromWebContents(e.sender);
  return bw ? bw.getBounds() : null;
});

ipcMain.handle('ns:win:set-bounds', (e, rect) => {
  const bw = BrowserWindow.fromWebContents(e.sender);
  if (!bw || bw.isDestroyed() || bw.isMaximized() || !rect) return;
  bw.setBounds({
    x: Math.round(rect.x), y: Math.round(rect.y),
    width: Math.round(rect.width), height: Math.round(rect.height),
  });
});

ipcMain.handle('ns:win:is-maximized', e => {
  const bw = BrowserWindow.fromWebContents(e.sender);
  return bw ? bw.isMaximized() : false;
});

ipcMain.handle('ns:dialog:open', (e, { name, params }) => {
  return NavigatorWindow.openDialog(ownerWin(e), name, params || {});
});

// ---- window.nsd surface ---------------------------------------------------

ipcMain.handle('nsd:params', e => {
  const d = NavigatorWindow.dialogFor(e.sender);
  return d ? d.params : {};
});

ipcMain.handle('nsd:close', (e, result) => {
  const d = NavigatorWindow.dialogFor(e.sender);
  if (d) {
    d.resolve(result === undefined ? null : result);
    d.resolve = () => {};
    if (!d.win.isDestroyed()) d.win.close();
  }
});

ipcMain.handle('nsd:pick', async (e, kind) => {
  const bw = BrowserWindow.fromWebContents(e.sender);
  const res = await dialog.showOpenDialog(bw && !bw.isDestroyed() ? bw : undefined, {
    properties: kind === 'directory' ? ['openDirectory', 'createDirectory'] : ['openFile'],
  });
  return res.canceled ? null : (res.filePaths[0] || null);
});
