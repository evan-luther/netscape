'use strict';
// NavigatorWindow: frameless BrowserWindow (Win95 chrome) + WebContentsView (page).

const { BrowserWindow, WebContentsView, Menu, session, net, clipboard, screen } = require('electron');
const path = require('path');
const store = require('./store');

const ROOT = path.join(__dirname, '..', '..');
const CHROME_HTML = path.join(ROOT, 'src', 'renderer', 'chrome.html');
const CHROME_PRELOAD = path.join(ROOT, 'src', 'preload', 'chrome.js');
const CONTENT_PRELOAD = path.join(ROOT, 'src', 'preload', 'content.js');
const DIALOG_PRELOAD = path.join(ROOT, 'src', 'preload', 'dialog.js');

const windows = new Set();
const dialogs = new Map(); // dialog webContents -> {win, owner, name, resolve}
const hooks = { navigate: [], focus: [] };
let webRequestWired = false;

// True while a BrowserWindow/WebContents/View is still usable. Every async or
// late-firing path that touches one must check this first — Electron throws
// "Object has been destroyed" on any access after teardown.
function alive(o) { return !!o && !o.isDestroyed(); }

const DIALOG_SIZES = {
  bookmarks: [560, 420, true], history: [560, 420, true], prefs: [560, 460, false],
  about: [400, 340, false], find: [380, 140, false], documentinfo: [460, 380, false],
  downloads: [520, 360, true], openlocation: [420, 110, false], source: [640, 480, true],
  addressbook: [480, 360, true],
};

// win32/linux keyboard fallback: the hidden native menu bar is not a reliable
// accelerator path there, so dispatch the Navigator shortcut table from
// before-input-event on both webContents. The five editing commands
// (undo/cut/copy/paste/selectAll) are deliberately absent — native roles and
// the focused field's own bindings cover those.
const SHORTCUTS = [
  { key: 'n', cmd: true, id: 'file.newWindow' },
  { key: 'l', cmd: true, id: 'file.openLocation' },
  { key: 'o', cmd: true, id: 'file.openFile' },
  { key: 's', cmd: true, id: 'file.saveAs' },
  { key: 'p', cmd: true, id: 'file.print' },
  { key: 'w', cmd: true, id: 'file.close' },
  { key: 'f', cmd: true, id: 'edit.find' },
  { key: 'g', cmd: true, id: 'edit.findAgain' },
  { key: 'r', cmd: true, id: 'view.reload' },
  { key: 'r', cmd: true, shift: true, id: 'view.reloadForce' },
  { key: 'u', cmd: true, id: 'view.source' },
  { key: 'd', cmd: true, id: 'bookmarks.add' },
  { key: 'b', cmd: true, id: 'bookmarks.view' },
  { key: 'left', alt: true, id: 'go.back' },
  { key: 'right', alt: true, id: 'go.forward' },
  { key: 'home', alt: true, id: 'go.home' },
  { key: 'escape', id: 'go.stop' },
];

function shortcutFor(input) {
  const key = String(input.key || '').toLowerCase().replace(/^arrow/, '');
  for (const s of SHORTCUTS) {
    if (s.key === key &&
        !!input.alt === !!s.alt &&
        !!input.shift === !!s.shift &&
        !!(input.control || input.meta) === !!s.cmd) {
      return s.id;
    }
  }
  return null;
}

function emitHook(name, arg) {
  for (const fn of hooks[name]) { try { fn(arg); } catch (e) { console.error(e); } }
}

function wireWebRequest() {
  if (webRequestWired) return;
  webRequestWired = true;
  const ses = session.defaultSession;

  // Image blocking: global pref, per-window override via view.loadImages.
  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'], types: ['image'] }, (details, cb) => {
    if (details.resourceType && details.resourceType !== 'image') return cb({});
    const nav = NavigatorWindow.fromWebContentsId(details.webContentsId);
    const block = nav && nav._imagesEnabled !== null ? !nav._imagesEnabled : !store.prefs().autoLoadImages;
    cb(block ? { cancel: true } : {});
  });

  // "Netsite" detection: Server header containing Netscape, per content view.
  ses.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, cb) => {
    const nav = NavigatorWindow.fromWebContentsId(details.webContentsId);
    if (nav && details.resourceType === 'mainFrame') {
      const h = details.responseHeaders || {};
      const server = (h.Server || h.server || [])[0] || '';
      nav._netsite = /netscape/i.test(server);
    }
    cb({});
  });
}

class NavigatorWindow {
  constructor(target) {
    wireWebRequest();
    windows.add(this);

    this._contentRect = null;
    this._loading = false;
    this._netsite = false;
    this._hoverText = '';
    this._loadPhase = '';
    this._progress = 0;
    this._progressTimer = null;
    this._autoScheme = false;   // true while a bare-host https:// guess is in flight
    this._navUrl = null;        // last committed main-frame URL (for history)
    this._imagesEnabled = null; // null = follow prefs, true = view.loadImages override
    this._lastFind = null;

    this.win = new BrowserWindow({
      frame: false,
      thickFrame: true, // keeps WS_THICKFRAME on win32 — required for any resize
      roundedCorners: false,
      resizable: true,
      width: 1024,
      height: 768,
      minWidth: 420,
      minHeight: 300,
      backgroundColor: '#c0c0c0',
      show: false,
      webPreferences: {
        preload: CHROME_PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    if (process.platform !== 'darwin') {
      this.win.setMenuBarVisibility(false);
      this.win.autoHideMenuBar = true;
    }
    this.win.loadFile(CHROME_HTML);
    this.win.once('ready-to-show', () => { if (alive(this.win)) this.win.show(); });
    this.win.on('closed', () => {
      windows.delete(this);
      this._stopProgress();
      if (alive(this.view.webContents)) this.view.webContents.close();
      // Owned dialogs must not outlive (or resolve against) a dead owner.
      for (const [wc, d] of dialogs) {
        if (d.owner === this && alive(d.win)) d.win.close();
      }
    });
    this.win.on('focus', () => emitHook('focus', this));
    for (const ev of ['resize', 'maximize', 'unmaximize']) {
      this.win.on(ev, () => this._applyBounds());
    }

    this.view = new WebContentsView({
      webPreferences: {
        preload: CONTENT_PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.win.contentView.addChildView(this.view);
    this._wireContent();
    this._wireShortcuts();

    const url = target || (store.prefs().startsWith === 'blank' ? 'about:blank' : store.resolveHome(store.prefs().homepage));
    this.view.webContents.loadURL(url).catch(() => {});
  }

  // ---- lookups -----------------------------------------------------------

  static get all() { return windows; }
  static focused() {
    const w = BrowserWindow.getFocusedWindow();
    if (!w || w.isDestroyed()) return null;
    for (const nav of windows) if (nav.win === w) return nav;
    const d = dialogs.get(w.webContents);
    return d && alive(d.owner.win) ? d.owner : null;
  }
  static fromWebContents(wc) {
    if (!alive(wc)) return null;
    for (const nav of windows) {
      if (!alive(nav.win)) continue;
      if (nav.win.webContents === wc || nav.view.webContents === wc) return nav;
    }
    const d = dialogs.get(wc);
    return d && alive(d.owner.win) ? d.owner : null;
  }
  static fromWebContentsId(id) {
    for (const nav of windows) {
      if (!alive(nav.win) || !alive(nav.view.webContents)) continue;
      if (nav.view.webContents.id === id || nav.win.webContents.id === id) return nav;
    }
    return null;
  }
  static dialogFor(wc) { return dialogs.get(wc) || null; }
  static onNavigate(fn) { hooks.navigate.push(fn); }
  static onFocus(fn) { hooks.focus.push(fn); }

  // ---- layout ------------------------------------------------------------

  setContentBounds(rect) {
    this._contentRect = {
      x: Math.round(rect.x), y: Math.round(rect.y),
      width: Math.round(rect.width), height: Math.round(rect.height),
    };
    this._applyBounds();
  }

  _applyBounds() {
    if (!this._contentRect || !alive(this.win)) return;
    const { width, height } = this.win.getContentBounds();
    const r = this._contentRect;
    const x = Math.max(0, Math.min(r.x, width));
    const y = Math.max(0, Math.min(r.y, height));
    this.view.setBounds({
      x, y,
      width: Math.max(0, Math.min(r.width, width - x)),
      height: Math.max(0, Math.min(r.height, height - y)),
    });
  }

  // Popup menus live in the chrome renderer, which sits *below* the content
  // WebContentsView, so a dropdown would clip at the content edge. Freeze the
  // page to a still image the chrome can paint, then hide the native view.
  async freezeContent() {
    if (!alive(this.win) || !alive(this.view.webContents)) return null;
    try {
      const img = await this.view.webContents.capturePage();
      return img.isEmpty() ? null : img.toDataURL();
    } catch {
      return null;
    }
  }

  setContentVisible(visible) {
    if (alive(this.win)) this.view.setVisible(!!visible);
  }

  // ---- navigation --------------------------------------------------------

  navigate(url, autoScheme) {
    if (!alive(this.view.webContents)) return;
    this._autoScheme = !!autoScheme;
    this.view.webContents.loadURL(url).catch(() => {});
  }



  _send(channel, payload) {
    const wc = this.win.webContents;
    if (alive(wc)) wc.send(channel, payload);
  }

  _sendState() {
    const wc = this.view.webContents;
    if (!alive(wc)) return;
    const url = wc.getURL();
    const all = wc.navigationHistory.getAllEntries();
    this._send('nav:state', {
      url,
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      loading: this._loading,
      secure: url.startsWith('https:'),
      netsite: this._netsite,
      zoom: wc.zoomLevel,
      // True session-stack indices — the Go menu passes them to goToIndex.
      entries: all.map((e, i) => ({ index: i, title: e.title, url: e.url })).slice(-15),
      activeIndex: wc.navigationHistory.getActiveIndex(),
    });
  }

  _sendStatus() {
    const text = this._loading ? this._loadPhase : (this._hoverText || 'Document: Done');
    this._send('nav:status', { text });
  }

  _startProgress() {
    this._stopProgress();
    this._progress = 15;
    this._send('nav:progress', { percent: this._progress });
    this._progressTimer = setInterval(() => {
      this._progress = Math.min(85, this._progress + 7);
      this._send('nav:progress', { percent: this._progress });
    }, 250);
  }

  _stopProgress(done) {
    if (this._progressTimer) { clearInterval(this._progressTimer); this._progressTimer = null; }
    if (done) {
      this._send('nav:progress', { percent: 100 });
      setTimeout(() => this._send('nav:progress', { percent: 0 }), 400);
    }
  }

  _wireContent() {
    const wc = this.view.webContents;

    wc.setWindowOpenHandler(({ url }) => {
      new NavigatorWindow(url || 'about:blank');
      return { action: 'deny' };
    });

    wc.on('did-start-loading', () => {
      this._loading = true;
      this._netsite = false;
      this._loadPhase = 'Connect: Contacting host...';
      this._startProgress();
      this._sendStatus();
      this._sendState();
    });

    wc.on('did-navigate', (e, url) => {
      this._navUrl = url;
      this._loadPhase = 'Transferring data...';
      this._sendStatus();
      this._sendState();
      if (/^(https?|file):/.test(url)) store.addHistory({ url, title: url });
      emitHook('navigate', this);
    });

    wc.on('did-navigate-in-page', () => { this._sendState(); emitHook('navigate', this); });

    wc.on('page-title-updated', () => this._sendState());

    wc.on('page-favicon-updated', (e, favicons) => {
      const fav = favicons && favicons[0];
      if (!fav) return this._send('nav:favicon', { dataUrl: null });
      if (fav.startsWith('data:')) return this._send('nav:favicon', { dataUrl: fav });
      net.fetch(fav).then(async res => {
        if (!res.ok) throw new Error('favicon ' + res.status);
        const buf = Buffer.from(await res.arrayBuffer());
        const mime = res.headers.get('content-type') || 'image/x-icon';
        this._send('nav:favicon', { dataUrl: `data:${mime};base64,${buf.toString('base64')}` });
      }).catch(() => this._send('nav:favicon', { dataUrl: null }));
    });

    wc.on('did-stop-loading', () => {
      this._loading = false;
      this._stopProgress(true);
      this._sendStatus();
      this._sendState();
      if (this._navUrl) store.setHistoryTitle(this._navUrl, wc.getTitle());
    });

    wc.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
      if (!isMainFrame || code === -3) return; // -3 = ERR_ABORTED (redirect/stop)
      if (this._autoScheme && url.startsWith('https://') &&
          /ERR_CONNECTION_REFUSED|ERR_SSL|ERR_CONNECTION_CLOSED|ERR_CONNECTION_RESET/.test(desc)) {
        this._autoScheme = false;
        this.navigate('http://' + url.slice('https://'.length));
        return;
      }
      this._autoScheme = false;
      this._loading = false;
      this._stopProgress(true);
      this._send('nav:status', { text: desc });
      this._sendState();
    });

    wc.on('update-target-url', (e, url) => {
      this._hoverText = url || '';
      this._sendStatus();
    });

    wc.on('dom-ready', () => this._sendState());

    wc.on('found-in-page', (e, r) => {
      this._send('find:result', { matches: r.matches, active: r.activeMatchOrdinal });
    });

    wc.on('context-menu', (e, params) => this.showContextMenu(params));
  }

  // win32/linux only: hidden menu accelerators are unreliable there, so map
  // the shortcut table ourselves. Only the focused webContents may fire —
  // chrome and content never hold focus at once, so no double-dispatch.
  _wireShortcuts() {
    if (process.platform === 'darwin') return;
    const attach = wc => {
      wc.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown' || !wc.isFocused()) return;
        const id = shortcutFor(input);
        if (!id) return;
        event.preventDefault();
        require('./commands').run(id, this);
      });
    };
    attach(this.win.webContents);
    attach(this.view.webContents);
  }

  // ---- context menu ------------------------------------------------------

  showContextMenu(params = {}) {
    if (!alive(this.win) || !alive(this.view.webContents)) return;
    const wc = this.view.webContents;
    const run = id => () => require('./commands').run(id, this);
    const items = [
      { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: run('go.back') },
      { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: run('go.forward') },
      { label: 'Reload', click: run('view.reload') },
      { label: 'Stop', enabled: this._loading, click: run('go.stop') },
      { type: 'separator' },
      {
        label: 'Open this Link', enabled: !!params.linkURL,
        click: () => params.linkURL && this.navigate(params.linkURL),
      },
      {
        label: 'Add Bookmark for this Link', enabled: !!params.linkURL,
        click: () => params.linkURL && store.addBookmark({ title: params.linkText || params.linkURL, url: params.linkURL }),
      },
      {
        label: 'Copy this Link Location', enabled: !!params.linkURL,
        click: () => params.linkURL && clipboard.writeText(params.linkURL),
      },
      { type: 'separator' },
      {
        label: 'Save this Image as...', enabled: params.mediaType === 'image',
        click: () => params.srcURL && session.defaultSession.downloadURL(params.srcURL),
      },
      {
        label: 'Copy this Image', enabled: params.mediaType === 'image',
        click: () => wc.copyImageAt(params.x, params.y),
      },
      { type: 'separator' },
      { label: 'View Source', click: run('view.source') },
      { label: 'Add Bookmark', click: run('bookmarks.add') },
    ];
    Menu.buildFromTemplate(items).popup({ window: this.win });
  }

  // ---- per-window commands ------------------------------------------------

  find(text, opts = {}) {
    if (!text || !alive(this.view.webContents)) return;
    this._lastFind = { text, forward: opts.forward !== false, matchCase: !!opts.matchCase };
    this.view.webContents.findInPage(text, {
      forward: this._lastFind.forward,
      matchCase: this._lastFind.matchCase,
      findNext: false,
    });
  }

  findAgain() {
    if (!this._lastFind || !alive(this.view.webContents)) return;
    this.view.webContents.findInPage(this._lastFind.text, {
      forward: this._lastFind.forward,
      matchCase: this._lastFind.matchCase,
      findNext: true,
    });
  }

  findStop(action) {
    if (!alive(this.view.webContents)) return;
    this.view.webContents.stopFindInPage(action === 'keepSelection' ? 'keepSelection' : 'clearSelection');
  }

  print() { if (alive(this.view.webContents)) this.view.webContents.print(); }

  savePage() {
    if (!alive(this.win) || !alive(this.view.webContents)) return Promise.resolve(null);
    const { dialog } = require('electron');
    const wc = this.view.webContents;
    const name = (wc.getTitle() || 'document').replace(/[\\/:*?"<>|]/g, '_') + '.html';
    return dialog.showSaveDialog(this.win, { defaultPath: name }).then(res => {
      if (res.canceled || !res.filePath || !alive(wc)) return null;
      return wc.savePage(res.filePath, 'HTMLComplete');
    });
  }

  async viewSource() {
    const wc = this.view.webContents;
    if (!alive(wc)) return null;
    const html = await wc.executeJavaScript('document.documentElement.outerHTML').catch(() => '');
    if (!alive(wc)) return null;
    return NavigatorWindow.openDialog(this, 'source', { url: wc.getURL(), html });
  }

  zoom(delta) {
    const wc = this.view.webContents;
    if (!alive(wc)) return;
    wc.zoomLevel = Math.max(-3, Math.min(5, wc.zoomLevel + delta));
    this._sendState();
  }

  setImagesEnabled(on) {
    if (!alive(this.view.webContents)) return;
    this._imagesEnabled = !!on;
    this.view.webContents.reload();
  }

  // ---- dialogs ------------------------------------------------------------

  static openDialog(owner, name, params = {}) {
    if (!DIALOG_SIZES[name]) return Promise.resolve(null);
    for (const [wc, d] of dialogs) {
      if (!alive(d.win)) { dialogs.delete(wc); continue; }
      if (d.owner === owner && d.name === name) {
        d.params = params;
        d.win.focus();
        if (alive(d.win.webContents)) d.win.webContents.send('dialog:params', params);
        return d.promise;
      }
    }
    const [w, h, resizable] = DIALOG_SIZES[name] || [420, 300, false];
    const win = new BrowserWindow({
      parent: owner && alive(owner.win) ? owner.win : undefined,
      frame: false,
      thickFrame: true,
      roundedCorners: false,
      width: w,
      height: h,
      resizable,
      minimizable: false,
      maximizable: resizable,
      backgroundColor: '#c0c0c0',
      show: false,
      webPreferences: {
        preload: DIALOG_PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        additionalArguments: ['--ns-dialog=' + name],
      },
    });
    if (process.platform !== 'darwin') {
      win.setMenuBarVisibility(false);
      win.autoHideMenuBar = true;
    }
    // Capture webContents NOW: after 'closed', win.webContents itself throws.
    const wc = win.webContents;
    const rec = { win, owner, name, params, resolve: null, promise: null };
    rec.promise = new Promise(res => { rec.resolve = res; });
    dialogs.set(wc, rec);
    const show = () => { if (alive(win) && !win.isVisible()) win.show(); };
    setTimeout(show, 3000); // fallback: never leave the window hidden
    win.on('closed', () => {
      dialogs.delete(wc);
      rec.resolve(null); // no-op if nsd:close already settled it
    });
    // Auto-fit to content once loaded; DIALOG_SIZES is only the initial size.
    // The dialog shell is content-sized (dialogs.css), so its border-box rect
    // is the real content size — documentElement.scrollHeight would just echo
    // the viewport. Tabbed dialogs are sized for their tallest page.
    wc.once('did-finish-load', () => {
      if (!alive(win) || !alive(wc)) return;
      wc.executeJavaScript(`(function () {
        var shell = document.querySelector('.w95-window') || document.body.firstElementChild;
        if (!shell) return null;
        var panels = Array.prototype.slice.call(shell.querySelectorAll('.w95-tabpanel'));
        var was = null, maxH = 0;
        panels.forEach(function (p) {
          if (p.classList.contains('is-active')) was = p;
          p.classList.remove('is-active');
        });
        panels.forEach(function (p) {
          p.classList.add('is-active');
          maxH = Math.max(maxH, shell.getBoundingClientRect().height);
          p.classList.remove('is-active');
        });
        if (was) was.classList.add('is-active');
        var r = shell.getBoundingClientRect();
        document.body.setAttribute('data-fill', '');
        return [Math.ceil(r.width), Math.ceil(Math.max(r.height, maxH))];
      })()`)
        .then(size => {
          if (!Array.isArray(size) || !alive(win)) return;
          const max = screen.getDisplayMatching(win.getBounds()).workAreaSize;
          const maxW = Math.floor(max.width * 0.9), maxH = Math.floor(max.height * 0.9);
          // Resizable list dialogs keep their initial size; fixed dialogs fit content.
          const cw = resizable ? Math.max(w, Math.min(size[0], maxW)) : Math.max(240, Math.min(size[0], maxW));
          const ch = resizable ? Math.min(h, maxH) : Math.max(120, Math.min(size[1], maxH));
          win.setContentSize(cw, ch);
          if (owner && alive(owner.win)) {
            const p = owner.win.getBounds();
            win.setPosition(
              Math.round(p.x + (p.width - win.getBounds().width) / 2),
              Math.round(p.y + (p.height - win.getBounds().height) / 2));
          } else {
            win.center();
          }
        })
        .catch(() => {})
        .finally(show);
    });
    win.loadFile(path.join(ROOT, 'src', 'renderer', 'dialogs', name + '.html'));
    return rec.promise;
  }
}

module.exports = { NavigatorWindow };
