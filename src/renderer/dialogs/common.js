/* Shared helpers for all Netscape dialog windows.
 * Loaded before each <name>.js. Provides:
 *   - a window.nsd shim so dialogs can be opened directly in a browser
 *   - dlg.* helpers: DOM, titlebar wiring, menubar popups, tree building
 */
(function () {
  'use strict';

  /* ---- window.nsd shim (browser preview / missing preload) ---- */
  if (!window.nsd) {
    var noop = function () {};
    var resolved = function (v) { return Promise.resolve(v); };
    window.nsd = {
      platform: 'win32',
      name: (location.pathname.split('/').pop() || '').replace(/\.html$/, ''),
      params: function () { return resolved({}); },
      on: function () { return noop; },
      command: function (id, arg) { console.log('nsd.command', id, arg); return resolved(null); },
      close: function (result) { console.log('nsd.close', result); window.close(); },
      prefs: {
        get: function () {
          return resolved({
            homepage: 'about:home', startsWith: 'home',
            toolbars: { navigation: true, location: true, directory: true, style: 'both' },
            autoLoadImages: true, underlineLinks: true,
            searchUrl: 'https://duckduckgo.com/?q=%s',
            fonts: { serif: 'Times New Roman', sansSerif: 'Arial', fixed: 'Courier New', defaultSize: 16, fixedSize: 13 },
            colors: { link: '#0000ee', visited: '#551a8b', text: '#000000', background: '#c0c0c0', useDocumentColors: true },
            network: { memCacheMB: 1, diskCacheMB: 5, proxyMode: 'none', httpProxy: '', httpProxyPort: 0 },
            security: { warnEnteringSecure: false, warnLeavingSecure: false, warnSubmitInsecure: true, acceptCookies: 'always' },
            directory: {
              netscapeHome: 'about:home', whatsNew: 'https://news.ycombinator.com/newest',
              whatsCool: 'https://news.ycombinator.com/', destinations: 'https://curlie.org/',
              netSearch: 'https://duckduckgo.com/', people: 'https://duckduckgo.com/?q=people+search',
              software: 'https://archive.org/details/softwarelibrary'
            },
            homepageIsLocal: true
          });
        },
        set: function (patch) { console.log('prefs.set', patch); return resolved(patch); }
      },
      bookmarks: {
        list: function () { return resolved([]); },
        add: function (b) { console.log('bookmarks.add', b); return resolved(b); },
        remove: function (id) { console.log('bookmarks.remove', id); return resolved(); },
        update: function (id, p) { console.log('bookmarks.update', id, p); return resolved(p); }
      },
      history: {
        list: function () { return resolved([]); },
        clear: function () { console.log('history.clear'); return resolved(); }
      },
      win: { minimize: noop, maximize: noop, close: function () { window.close(); } },
      pick: function (kind) { console.log('nsd.pick', kind); return resolved(null); }
    };
  }

  /* ---- DOM helpers ---- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function fmtDate(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getMonth() + 1) + '/' + p(d.getDate()) + '/' + d.getFullYear() +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function fmtBytes(n) {
    if (n == null || n < 0) return 'Unknown';
    if (n < 1024) return n + ' bytes';
    if (n < 1048576) return Math.round(n / 1024) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  /* ---- window chrome ---- */
  function initWindow() {
    var x = $('.w95-tbtn.close');
    if (x) x.addEventListener('click', function () { window.nsd.win.close(); });
  }

  /* Escape cancels, Enter presses the default button (.w95-btn.is-default). */
  function keys(opts) {
    opts = opts || {};
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (dlg._openMenu) { dlg._openMenu.close(); return; }
        if (opts.onEscape) opts.onEscape(); else window.nsd.close();
      } else if (e.key === 'Enter' && !opts.noEnter) {
        var t = e.target;
        if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON')) return;
        if (opts.onEnter) { opts.onEnter(); return; }
        var def = $('.w95-btn.is-default');
        if (def && !def.disabled) def.click();
      }
    });
  }

  /* ---- menubar ----
   * menus: [{ label:'File', items:[{label, accel, disabled, checked, onSelect} | '-'] }]
   * Renders .w95-menubar of .w95-menubar-item buttons with .w95-menu popups.
   */
  function menubar(menus) {
    var bar = el('div', 'w95-menubar');
    var open = null;

    function closeMenu() {
      if (!open) return;
      open.popup.remove();
      open.btn.classList.remove('is-open');
      open = null;
      dlg._openMenu = null;
      document.removeEventListener('mousedown', onDocDown, true);
    }
    function onDocDown(e) {
      if (open && !open.popup.contains(e.target) && e.target !== open.btn) closeMenu();
    }
    function show(btn, menu) {
      closeMenu();
      var popup = el('div', 'w95-menu');
      menu.items.forEach(function (it) {
        if (it === '-') { popup.appendChild(el('div', 'w95-menu-sep')); return; }
        var row = el('div', 'w95-menuitem' + (it.disabled ? ' is-disabled' : '') +
          (it.checked ? ' is-checked' : ''));
        row.appendChild(document.createTextNode(it.label));
        if (it.accel) row.appendChild(el('span', 'w95-menu-accel', it.accel));
        if (!it.disabled && it.onSelect) {
          row.addEventListener('click', function () { closeMenu(); it.onSelect(); });
        }
        popup.appendChild(row);
      });
      document.body.appendChild(popup);
      var r = btn.getBoundingClientRect();
      popup.style.left = r.left + 'px';
      popup.style.top = r.bottom + 'px';
      btn.classList.add('is-open');
      open = { btn: btn, popup: popup };
      dlg._openMenu = { close: closeMenu };
      document.addEventListener('mousedown', onDocDown, true);
    }

    menus.forEach(function (menu) {
      var btn = el('span', 'w95-menubar-item', menu.label);
      btn.addEventListener('click', function () {
        if (open && open.btn === btn) closeMenu(); else show(btn, menu);
      });
      btn.addEventListener('mouseenter', function () {
        if (open && open.btn !== btn) show(btn, menu);
      });
      bar.appendChild(btn);
    });
    return bar;
  }

  /* ---- tree ----
   * buildTree(container, rootNode, opts)
   *   node: { label, icon, isFolder, entry, folders:[node], items:[node] }
   *   opts: { expanded:Set, onSelect(node,row), onActivate(node), selected:node }
   * Renders .w95-tree rows with twisties; folders toggle on twisty click.
   */
  function buildTree(container, root, opts) {
    opts = opts || {};
    var expanded = opts.expanded || new Set();
    container.innerHTML = '';
    container.classList.add('w95-tree');

    /* anc[i] = the ancestor at column i has following siblings, so its
     * vertical dotted line continues through this row. The node's own
     * column (last) always gets the .is-h horizontal stub. */
    function row(node, anc, depth) {
      var r = el('div', 'w95-tree-row');
      anc.forEach(function (cont) {
        var line = el('span', 'w95-tree-line');
        if (!cont) line.style.visibility = 'hidden';
        r.appendChild(line);
      });
      if (depth > 0) r.appendChild(el('span', 'w95-tree-line is-h'));
      var tw = el('span', 'w95-tree-twisty' + (node.isFolder ? '' : ' is-leaf'));
      if (node.isFolder) {
        if (expanded.has(node)) r.classList.add('is-open');
        tw.addEventListener('click', function (e) {
          e.stopPropagation();
          if (expanded.has(node)) expanded.delete(node); else expanded.add(node);
          buildTree(container, root, opts);
        });
      }
      r.appendChild(tw);
      if (node.icon) {
        var img = el('img', 'w95-icon');
        img.src = node.icon;
        img.width = 16; img.height = 16;
        img.alt = '';
        img.draggable = false;
        r.appendChild(img);
      }
      r.appendChild(el('span', 'w95-tree-label', node.label));
      if (opts.selected === node) r.classList.add('is-selected');
      r.addEventListener('click', function () {
        $$('.w95-tree-row.is-selected', container).forEach(function (x) {
          x.classList.remove('is-selected');
        });
        r.classList.add('is-selected');
        opts.selected = node;
        if (opts.onSelect) opts.onSelect(node, r);
      });
      r.addEventListener('dblclick', function () {
        if (node.isFolder) {
          if (expanded.has(node)) expanded.delete(node); else expanded.add(node);
          buildTree(container, root, opts);
        } else if (opts.onActivate) opts.onActivate(node);
      });
      return r;
    }

    function emit(node, anc, cont, depth) {
      container.appendChild(row(node, anc, depth));
      if (node.isFolder && expanded.has(node)) {
        var kids = node.folders.concat(node.items);
        var childAnc = depth === 0 ? [] : anc.concat(cont);
        kids.forEach(function (k, i) {
          emit(k, childAnc, i < kids.length - 1, depth + 1);
        });
      }
    }
    var top = root.folders.concat(root.items);
    top.forEach(function (k, i) {
      emit(k, [], i < top.length - 1, 0);
    });
  }

  /* Group flat Bookmark[] into a folder tree.
   * Bookmarks with url === '' are explicit folder entries (Navigator folders).
   * Returns { root, at(path) } — root is the implicit '' folder. */
  function folderTree(bookmarks, icons) {
    icons = icons || {};
    var nodes = { '': { label: '', path: '', isFolder: true, folders: [], items: [] } };
    function nodeFor(path) {
      if (!nodes[path]) {
        var name = path.split('/').pop();
        nodes[path] = { label: name, path: path, isFolder: true, folders: [], items: [] };
        var parent = path.indexOf('/') < 0 ? '' : path.slice(0, path.lastIndexOf('/'));
        nodeFor(parent).folders.push(nodes[path]);
      }
      return nodes[path];
    }
    (bookmarks || []).forEach(function (b) {
      if (b.url === '') {
        var path = b.folder ? b.folder + '/' + b.title : b.title;
        var n = nodeFor(path);
        if (!n.entry) { n.label = b.title; n.entry = b; }
        return;
      }
      nodeFor(b.folder || '').items.push({
        label: b.title || b.url, isFolder: false, entry: b, icon: icons.bookmark
      });
    });
    Object.keys(nodes).forEach(function (p) {
      if (p) nodes[p].icon = icons.folder;
    });
    return { root: nodes[''], at: function (p) { return nodes[p]; } };
  }

  window.dlg = {
    $: $, $$: $$, el: el,
    fmtDate: fmtDate, fmtBytes: fmtBytes,
    initWindow: initWindow, keys: keys,
    menubar: menubar, buildTree: buildTree, folderTree: folderTree
  };
})();
