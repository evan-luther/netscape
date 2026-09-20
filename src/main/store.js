'use strict';
// JSON persistence for prefs, bookmarks, history.
// Atomic writes (tmp + rename), debounced ~300ms, never throws on bad data.

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..');

const DEFAULT_PREFS = {
  homepage: 'about:home',
  startsWith: 'home',
  toolbars: { navigation: true, location: true, directory: true, style: 'both' },
  autoLoadImages: true,
  underlineLinks: true,
  searchUrl: 'https://duckduckgo.com/?q=%s',
  fonts: { serif: 'Times New Roman', sansSerif: 'Arial', fixed: 'Courier New', defaultSize: 16, fixedSize: 13 },
  colors: { link: '#0000ee', visited: '#551a8b', text: '#000000', background: '#c0c0c0', useDocumentColors: true },
  network: { memCacheMB: 1, diskCacheMB: 5, proxyMode: 'none', httpProxy: '', httpProxyPort: 0 },
  security: { warnEnteringSecure: false, warnLeavingSecure: false, warnSubmitInsecure: true, acceptCookies: 'always' },
  directory: {
    netscapeHome: 'about:home',
    whatsNew: 'https://news.ycombinator.com/newest',
    whatsCool: 'https://news.ycombinator.com/',
    destinations: 'https://curlie.org/',
    netSearch: 'https://duckduckgo.com/',
    people: 'https://duckduckgo.com/?q=people+search',
    software: 'https://archive.org/details/softwarelibrary',
  },
  homepageIsLocal: true,
};

const HISTORY_CAP = 2000;

let data = null; // {prefs, bookmarks, history}
let saveTimer = null;
const listeners = Object.create(null);

function file() {
  return path.join(app.getPath('userData'), 'netscape.json');
}

// Shallow merge at top level; one level deep for nested plain objects.
function mergePrefs(base, patch) {
  const out = Object.assign({}, base);
  for (const [k, v] of Object.entries(patch || {})) {
    const b = base[k];
    if (v && b && typeof v === 'object' && typeof b === 'object' && !Array.isArray(v) && !Array.isArray(b)) {
      out[k] = Object.assign({}, b, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function load() {
  if (data) return data;
  data = { prefs: mergePrefs(DEFAULT_PREFS, {}), bookmarks: [], history: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
    if (raw && typeof raw === 'object') {
      data.prefs = mergePrefs(DEFAULT_PREFS, raw.prefs);
      if (Array.isArray(raw.bookmarks)) data.bookmarks = raw.bookmarks;
      if (Array.isArray(raw.history)) data.history = raw.history;
    }
  } catch (_) { /* missing/corrupt file -> defaults */ }
  return data;
}

function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!data) return;
  try {
    const f = file();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, f);
  } catch (_) { /* disk full / readonly: keep running, lose nothing in memory */ }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}

function emit(event) {
  for (const fn of listeners[event] || []) {
    try { fn(); } catch (e) { console.error('store listener', e); }
  }
}

app.once('before-quit', flush);

let seq = 0;
function newId() {
  return 'b' + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);
}

// 'about:home' sentinel -> bundled start page. Used by every homepage read.
function resolveHome(url) {
  return url === 'about:home'
    ? pathToFileURL(path.join(ROOT, 'src', 'renderer', 'home.html')).href
    : url;
}

module.exports = {
  on(event, fn) { (listeners[event] = listeners[event] || []).push(fn); },

  prefs() { return load().prefs; },

  resolveHome,

  setPrefs(patch) {
    const d = load();
    d.prefs = mergePrefs(d.prefs, patch);
    scheduleSave();
    emit('prefs');
    return d.prefs;
  },

  bookmarks() { return load().bookmarks; },

  addBookmark({ title, url, folder }) {
    const b = { id: newId(), title: title || url, url, added: Date.now(), lastVisited: null, folder: folder || null };
    load().bookmarks.push(b);
    scheduleSave();
    emit('bookmarks');
    return b;
  },

  removeBookmark(id) {
    const d = load();
    const i = d.bookmarks.findIndex(b => b.id === id);
    if (i >= 0) {
      d.bookmarks.splice(i, 1);
      scheduleSave();
      emit('bookmarks');
    }
  },

  updateBookmark(id, patch) {
    const b = load().bookmarks.find(b => b.id === id);
    if (!b) return null;
    Object.assign(b, patch, { id: b.id });
    scheduleSave();
    emit('bookmarks');
    return b;
  },

  history() { return load().history; },

  addHistory({ url, title }) {
    const d = load();
    const i = d.history.findIndex(e => e.url === url);
    const count = i >= 0 ? (d.history[i].count || 0) + 1 : 1;
    if (i >= 0) d.history.splice(i, 1);
    d.history.unshift({ url, title: title || url, visited: Date.now(), count });
    if (d.history.length > HISTORY_CAP) d.history.length = HISTORY_CAP;
    scheduleSave();
    emit('history');
  },

  // Patch the title of the newest entry for url (title arrives after did-navigate).
  setHistoryTitle(url, title) {
    const e = load().history.find(e => e.url === url);
    if (e && title && e.title !== title) {
      e.title = title;
      scheduleSave();
    }
  },

  clearHistory() {
    load().history.length = 0;
    scheduleSave();
    emit('history');
  },
};
