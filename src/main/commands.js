'use strict';
// Single command table, dispatched from the HTML menu bar (via ns:command IPC)
// and from native Menu accelerators. Unknown ids log and return null.

const { app, webContents, dialog } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const store = require('./store');
const { NavigatorWindow } = require('./window');
const downloads = require('./downloads');

const DIRECTORY_KEYS = ['netscapeHome', 'whatsNew', 'whatsCool', 'destinations', 'netSearch', 'people', 'software'];

// Smart URL-or-search resolution, shared by ns:navigate and the 'navigate' id.
function resolveTarget(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  // Bare hosts/IPs/localhost[:port] -> https:// (http:// fallback on fail-load).
  if (/^localhost(:\d+)?(\/|$)/.test(t) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(t) ||
      /^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(t)) {
    return { url: 'https://' + t, autoScheme: true };
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t)) return { url: store.resolveHome(t), autoScheme: false }; // has scheme (about:, file:, ...)
  const tmpl = store.prefs().searchUrl || 'https://duckduckgo.com/?q=%s';
  return { url: tmpl.replace('%s', encodeURIComponent(t)), autoScheme: false };
}

function focusedContents(win) {
  return webContents.getFocusedWebContents() || (win && win.view.webContents);
}

function toggleToolbar(win, key, id) {
  const toolbars = Object.assign({}, store.prefs().toolbars);
  toolbars[key] = !toolbars[key];
  store.setPrefs({ toolbars });
  if (win) win._send('ui:command', { id, arg: null });
}

function dataPage(title, bodyHtml) {
  const page = '<!DOCTYPE html><html><head><title>' + title + '</title></head>' +
    '<body bgcolor="#ffffff" text="#000000" link="#0000ee" vlink="#551a8b">' +
    '<font face="Times New Roman">' + bodyHtml + '</font></body></html>';
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(page);
}

function pluginsPage() {
  const v = process.versions;
  const rows = [
    ['Chromium', v.chrome], ['Electron', v.electron], ['Node.js', v.node], ['V8', v.v8],
  ].map(([n, ver]) => `<tr><td><b>${n}</b></td><td>${ver}</td></tr>`).join('');
  return dataPage('About Plug-ins',
    '<h2>Installed plug-ins</h2>' +
    '<p>Netscape Navigator (Chromium edition) ships with these built-in components:</p>' +
    '<table border="1" cellpadding="4" cellspacing="0">' +
    '<tr><th>Component</th><th>Version</th></tr>' + rows +
    '<tr><td><b>Chromium PDF Viewer</b></td><td>built-in</td></tr>' +
    '</table><hr><p><i>NPAPI plug-ins are not supported by this architecture.</i></p>');
}

function releaseNotesPage() {
  const v = process.versions;
  return dataPage('Netscape Navigator 3.04 Gold — Release Notes',
    '<center><h1>Netscape Navigator</h1><h3>Version 3.04 Gold</h3>' +
    '<p><i>Chromium Edition — Release Notes</i></p></center><hr>' +
    '<h3>Welcome</h3><p>This release of Netscape Navigator is rebuilt on the ' +
    'Chromium engine while preserving the classic Navigator 3.04 Gold interface.</p>' +
    '<h3>Engine versions</h3><ul>' +
    `<li>Chromium ${v.chrome}</li><li>Electron ${v.electron}</li>` +
    `<li>Node.js ${v.node}</li><li>V8 ${v.v8}</li></ul>` +
    '<h3>Known issues</h3><ul>' +
    '<li>Frames are rendered by the host engine and may differ cosmetically.</li>' +
    '<li>Java applets and NPAPI plug-ins are not supported.</li></ul>' +
    '<hr><p><i>Copyright &copy; 1996 Netscape Communications Corp. (reimplementation)</i></p>');
}

const handlers = {
  // ---- File ----
  // Must not return the NavigatorWindow: `run()` results cross IPC and a
  // window instance is not structured-cloneable.
  'file.newWindow': () => { new NavigatorWindow(); return null; },
  'file.openLocation': (win) => { if (win) win._send('ui:command', { id: 'file.openLocation', arg: null }); },
  'file.openFile': async (win) => {
    if (!win) return null;
    const res = await dialog.showOpenDialog(win.win, {
      properties: ['openFile'],
      filters: [
        { name: 'HTML Documents', extensions: ['html', 'htm', 'shtml', 'txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    win.navigate(pathToFileURL(res.filePaths[0]).href);
    return res.filePaths[0];
  },
  'file.saveAs': (win) => win && win.savePage(),
  'file.pageSetup': (win) => win && win.print(),
  'file.print': (win) => win && win.print(),
  'file.printPreview': async (win) => {
    if (!win) return null;
    const pdf = await win.view.webContents.printToPDF({ printBackground: true });
    const file = path.join(os.tmpdir(), 'netscape-preview-' + Date.now() + '.pdf');
    fs.writeFileSync(file, pdf);
    new NavigatorWindow(pathToFileURL(file).href);
    return file;
  },
  'file.close': (win) => { if (win) win.win.close(); },
  'file.exit': () => app.quit(),

  // ---- Edit ----
  'edit.undo': (win) => { const wc = focusedContents(win); if (wc) wc.undo(); },
  'edit.redo': (win) => { const wc = focusedContents(win); if (wc) wc.redo(); },
  'edit.cut': (win) => { const wc = focusedContents(win); if (wc) wc.cut(); },
  'edit.copy': (win) => { const wc = focusedContents(win); if (wc) wc.copy(); },
  'edit.paste': (win) => { const wc = focusedContents(win); if (wc) wc.paste(); },
  'edit.selectAll': (win) => { const wc = focusedContents(win); if (wc) wc.selectAll(); },
  'edit.find': (win, arg) => {
    if (arg && arg.text) { if (win) win.find(arg.text, arg); return null; }
    return NavigatorWindow.openDialog(win, 'find', {});
  },
  'edit.findAgain': (win) => { if (win) win.findAgain(); },

  // ---- View ----
  'view.reload': (win) => { if (win) win.view.webContents.reload(); },
  'view.reloadForce': (win) => { if (win) win.view.webContents.reloadIgnoringCache(); },
  'view.loadImages': (win) => { if (win) win.setImagesEnabled(true); },
  'view.refresh': (win) => { if (win) win.view.webContents.invalidate(); },
  'view.source': (win) => win && win.viewSource(),
  'view.documentInfo': async (win) => {
    if (!win) return null;
    const wc = win.view.webContents;
    const info = await wc.executeJavaScript(
      '({title:document.title,mime:document.contentType,lastModified:document.lastModified,charset:document.characterSet})'
    ).catch(() => ({}));
    return NavigatorWindow.openDialog(win, 'documentinfo', Object.assign({ url: wc.getURL() }, info));
  },
  'view.toolbar': (win) => toggleToolbar(win, 'navigation', 'view.toolbar'),
  'view.location': (win) => toggleToolbar(win, 'location', 'view.location'),
  'view.directory': (win) => toggleToolbar(win, 'directory', 'view.directory'),

  // ---- Go ----
  'go.back': (win) => { if (win) win.view.webContents.navigationHistory.goBack(); },
  'go.forward': (win) => { if (win) win.view.webContents.navigationHistory.goForward(); },
  'go.home': (win) => { if (win) win.navigate(store.resolveHome(store.prefs().homepage)); },
  'go.stop': (win) => { if (win) win.view.webContents.stop(); },
  'go.history': (win) => NavigatorWindow.openDialog(win, 'history', {}),
  'go.entry': (win, arg) => {
    if (win && typeof arg === 'number') win.view.webContents.navigationHistory.goToIndex(arg);
  },

  // ---- Bookmarks ----
  'bookmarks.add': (win) => {
    if (!win) return null;
    const wc = win.view.webContents;
    return store.addBookmark({ title: wc.getTitle() || wc.getURL(), url: wc.getURL() });
  },
  'bookmarks.view': (win) => NavigatorWindow.openDialog(win, 'bookmarks', {}),
  'bookmarks.open': (win, arg) => {
    if (!win) return null;
    const b = store.bookmarks().find(b => b.id === arg);
    if (b) win.navigate(b.url);
    return b || null;
  },

  // ---- Options ----
  'options.general': (win) => NavigatorWindow.openDialog(win, 'prefs', { page: 'appearance' }),
  'options.network': (win) => NavigatorWindow.openDialog(win, 'prefs', { page: 'network' }),
  'options.security': (win) => NavigatorWindow.openDialog(win, 'prefs', { page: 'security' }),
  'options.autoImages': () => store.setPrefs({ autoLoadImages: !store.prefs().autoLoadImages }),
  'options.showToolbar': (win) => handlers['view.toolbar'](win),
  'options.showLocation': (win) => handlers['view.location'](win),
  'options.showDirectory': (win) => handlers['view.directory'](win),
  'options.javaConsole': (win) => { if (win) win.view.webContents.openDevTools({ mode: 'detach' }); },

  // ---- Window ----
  'window.bookmarks': (win) => handlers['bookmarks.view'](win),
  'window.history': (win) => handlers['go.history'](win),
  'window.downloads': (win) => NavigatorWindow.openDialog(win, 'downloads', { downloads: downloads.list() }),
  'window.addressBook': (win) => NavigatorWindow.openDialog(win, 'addressbook', {}),

  // ---- Help ----
  'help.about': (win) => NavigatorWindow.openDialog(win, 'about', {
    versions: {
      app: app.getVersion(), electron: process.versions.electron,
      chromium: process.versions.chrome, node: process.versions.node, v8: process.versions.v8,
    },
  }),
  'help.aboutPlugins': (win) => { if (win) win.navigate(pluginsPage()); },
  'help.releaseNotes': (win) => { if (win) win.navigate(releaseNotesPage()); },

  // ---- Misc ----
  'nav.throbber': (win) => handlers['go.home'](win),
  'navigate': (win, arg) => {
    if (!win) return null;
    const t = resolveTarget(arg);
    if (t) win.navigate(t.url, t.autoScheme);
    return t;
  },
  'download.cancel': (win, arg) => downloads.cancel(arg),
};

for (const key of DIRECTORY_KEYS) {
  handlers['directory.' + key] = (win) => {
    const url = store.resolveHome(store.prefs().directory[key]);
    if (win && url) win.navigate(url);
  };
}

function run(id, win, arg) {
  const fn = handlers[id];
  if (!fn) {
    console.warn('commands: unknown id', id);
    return null;
  }
  try {
    return fn(win, arg);
  } catch (e) {
    console.error('commands: ' + id + ' failed', e);
    return null;
  }
}

module.exports = { run, resolveTarget };
