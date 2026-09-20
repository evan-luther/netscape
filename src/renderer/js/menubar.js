/* menubar.js — Win95 menu bar engine + Navigator 3.04 menu definitions.
   Exposes window.NSMenu = { init(ctx), popup(defs, x, y, opts), closeAll }.
   ctx = { getState(), getPrefs(), bookmarks(), command(id, arg) }.
   Item def: { label (HTML, <u> marks mnemonic), id, arg, accel,
               type: 'item'|'sep'|'check'|'submenu', enabled(), checked(),
               items (array | function -> array|Promise) }.
*/
(function () {
  'use strict';

  var SEP = { type: 'sep' };
  var SUBMENU_DELAY = 250;

  var ctx = null;
  var bar = null;
  var menus = [];        // stack of open .w95-menu elements, top-level first
  var openIndex = -1;    // index of open top-level menu, -1 = closed
  var openSeq = 0;       // guards async open races
  var subTimer = 0;
  var overlayOn = false;
  var thawTimer = 0;

  /* The page is a native view stacked above this document, so an open popup
     would be clipped. While any popup is up we swap the page for a still
     (ctx.freezeContent) and hide the view. Closing one menu to open another
     passes through zero open menus, so the un-freeze is deferred: otherwise
     dragging across the menu bar thrashes the view in and out. */
  function syncOverlay() {
    clearTimeout(thawTimer);
    if (menus.length) { beginOverlay(); return; }
    if (!overlayOn) return;
    thawTimer = setTimeout(function () {
      if (menus.length || !overlayOn) return;
      overlayOn = false;
      if (ctx && ctx.thawContent) ctx.thawContent();
    }, 80);
  }

  var IS_MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

  function accelText(accel) {
    if (!accel) return '';
    return IS_MAC ? accel.replace(/Ctrl\+/g, 'Cmd+').replace(/Alt\+/g, 'Opt+') : accel;
  }

  // Freeze eagerly when a popup is about to open, so the first painted frame is
  // already unclipped rather than clipped for a frame while the IPC lands.
  function beginOverlay() {
    clearTimeout(thawTimer);
    if (overlayOn) return;
    overlayOn = true;
    if (ctx && ctx.freezeContent) ctx.freezeContent();
  }

  /* ---------------- menu definitions ---------------- */

  function menuDefs() {
    return [
      { label: '<u>F</u>ile', items: [
        { label: 'New <u>W</u>eb Browser', id: 'file.newWindow', accel: 'Ctrl+N' },
        { label: 'Open <u>L</u>ocation...', id: 'file.openLocation', accel: 'Ctrl+L' },
        { label: 'Open <u>F</u>ile...', id: 'file.openFile', accel: 'Ctrl+O' },
        { label: '<u>S</u>ave As...', id: 'file.saveAs', accel: 'Ctrl+S' },
        SEP,
        { label: 'Page Set<u>u</u>p...', id: 'file.pageSetup' },
        { label: '<u>P</u>rint...', id: 'file.print', accel: 'Ctrl+P' },
        { label: 'Print Pre<u>v</u>iew', id: 'file.printPreview' },
        SEP,
        { label: '<u>C</u>lose', id: 'file.close', accel: 'Ctrl+W' },
        { label: 'E<u>x</u>it', id: 'file.exit' }
      ]},
      { label: '<u>E</u>dit', items: [
        { label: '<u>U</u>ndo', id: 'edit.undo', accel: 'Ctrl+Z' },
        SEP,
        { label: 'Cu<u>t</u>', id: 'edit.cut', accel: 'Ctrl+X' },
        { label: '<u>C</u>opy', id: 'edit.copy', accel: 'Ctrl+C' },
        { label: '<u>P</u>aste', id: 'edit.paste', accel: 'Ctrl+V' },
        SEP,
        { label: 'Select <u>A</u>ll', id: 'edit.selectAll', accel: 'Ctrl+A' },
        SEP,
        { label: '<u>F</u>ind...', id: 'edit.find', accel: 'Ctrl+F' },
        { label: 'Find A<u>g</u>ain', id: 'edit.findAgain', accel: 'Ctrl+G',
          enabled: function () { return ctx.getState().findPerformed; } }
      ]},
      { label: '<u>V</u>iew', items: [
        { label: '<u>R</u>eload', id: 'view.reload', accel: 'Ctrl+R' },
        { label: 'Load <u>I</u>mages', id: 'view.loadImages',
          enabled: function () { return !ctx.getPrefs().autoLoadImages; } },
        { label: 'Re<u>f</u>resh', id: 'view.refresh' },
        SEP,
        { label: '<u>D</u>ocument Source', id: 'view.source', accel: 'Ctrl+U' },
        { label: 'Document I<u>n</u>fo', id: 'view.documentInfo' },
        SEP,
        { label: 'Show <u>T</u>oolbar', id: 'view.toolbar', type: 'check',
          checked: function () { return ctx.getPrefs().toolbars.navigation; } },
        { label: 'Show <u>L</u>ocation', id: 'view.location', type: 'check',
          checked: function () { return ctx.getPrefs().toolbars.location; } },
        { label: 'Show Directory <u>B</u>uttons', id: 'view.directory', type: 'check',
          checked: function () { return ctx.getPrefs().toolbars.directory; } }
      ]},
      { label: '<u>G</u>o', items: function () {
        var st = ctx.getState();
        var items = [
          { label: '<u>B</u>ack', id: 'go.back', accel: 'Alt+Left',
            enabled: function () { return ctx.getState().canGoBack; } },
          { label: '<u>F</u>orward', id: 'go.forward', accel: 'Alt+Right',
            enabled: function () { return ctx.getState().canGoForward; } },
          { label: '<u>H</u>ome', id: 'go.home', accel: 'Alt+Home' },
          { label: 'S<u>t</u>op Loading', id: 'go.stop', accel: 'Esc',
            enabled: function () { return ctx.getState().loading; } }
        ];
        var entries = st.entries || [];
        if (!entries.length) return items;
        items.push(SEP);
        entries.forEach(function (e) {
          items.push({
            label: escapeLabel(e.title || e.url),
            id: 'go.entry', arg: e.index, type: 'check',
            checked: function () { return e.index === st.activeIndex; }
          });
        });
        return items;
      }},
      { label: '<u>B</u>ookmarks', items: function () {
        var items = [
          { label: '<u>A</u>dd Bookmark', id: 'bookmarks.add', accel: 'Ctrl+D' },
          { label: 'View <u>B</u>ookmarks', id: 'bookmarks.view', accel: 'Ctrl+B' }
        ];
        return ctx.bookmarks().then(function (list) {
          if (!list.length) return items;
          items.push(SEP);
          var folders = {};
          list.forEach(function (b) {
            var entry = { label: escapeLabel(b.title || b.url), id: 'bookmarks.open', arg: b.id };
            if (b.folder) {
              (folders[b.folder] = folders[b.folder] || []).push(entry);
            } else {
              items.push(entry);
            }
          });
          Object.keys(folders).sort().forEach(function (name) {
            items.push({ label: escapeLabel(name), type: 'submenu', items: folders[name] });
          });
          return items;
        });
      }},
      { label: '<u>O</u>ptions', items: [
        { label: '<u>G</u>eneral Preferences...', id: 'options.general' },
        { label: '<u>N</u>etwork Preferences...', id: 'options.network' },
        { label: '<u>S</u>ecurity Preferences...', id: 'options.security' },
        SEP,
        { label: 'Show <u>T</u>oolbar', id: 'options.showToolbar', type: 'check',
          checked: function () { return ctx.getPrefs().toolbars.navigation; } },
        { label: 'Show <u>L</u>ocation', id: 'options.showLocation', type: 'check',
          checked: function () { return ctx.getPrefs().toolbars.location; } },
        { label: 'Show <u>D</u>irectory Buttons', id: 'options.showDirectory', type: 'check',
          checked: function () { return ctx.getPrefs().toolbars.directory; } },
        SEP,
        { label: '<u>A</u>uto Load Images', id: 'options.autoImages', type: 'check',
          checked: function () { return ctx.getPrefs().autoLoadImages; } },
        { label: 'Show <u>J</u>ava Console', id: 'options.javaConsole' }
      ]},
      { label: '<u>D</u>irectory', items: [
        { label: "Netscape's <u>H</u>ome", id: 'directory.netscapeHome' },
        { label: "What's <u>N</u>ew?", id: 'directory.whatsNew' },
        { label: "What's <u>C</u>ool?", id: 'directory.whatsCool' },
        { label: 'Netscape <u>D</u>estinations', id: 'directory.destinations' },
        { label: 'Internet <u>S</u>earch', id: 'directory.netSearch' },
        { label: '<u>P</u>eople', id: 'directory.people' },
        { label: 'Soft<u>w</u>are', id: 'directory.software' }
      ]},
      { label: '<u>W</u>indow', items: [
        { label: 'Netscape <u>N</u>avigator', id: 'file.newWindow' },
        SEP,
        { label: '<u>B</u>ookmarks', id: 'window.bookmarks' },
        { label: '<u>A</u>ddress Book', id: 'window.addressBook' },
        { label: '<u>H</u>istory', id: 'window.history' },
        { label: '<u>S</u>aving Location', id: 'window.downloads' }
      ]},
      { label: '<u>H</u>elp', items: [
        { label: '<u>A</u>bout Netscape', id: 'help.about' },
        { label: 'About <u>P</u>lug-ins', id: 'help.aboutPlugins' },
        { label: '<u>R</u>elease Notes', id: 'help.releaseNotes' }
      ]}
    ];
  }

  function escapeLabel(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function mnemonicOf(labelHtml) {
    var m = /<u>(.)<\/u>/i.exec(labelHtml);
    return m ? m[1].toLowerCase() : null;
  }

  function isSub(it) {
    return it.type === 'submenu' || !!it.items;
  }

  /* ---------------- DOM construction ---------------- */

  function resolveItems(src) {
    var v = typeof src === 'function' ? src() : src;
    return Promise.resolve(v || []);
  }

  function buildMenuEl(defs) {
    var el = document.createElement('div');
    el.className = 'w95-menu';
    defs.forEach(function (it) {
      if (it.type === 'sep') {
        var sep = document.createElement('div');
        sep.className = 'w95-menu-sep';
        el.appendChild(sep);
        return;
      }
      var row = document.createElement('div');
      row.className = 'w95-menuitem';
      row._def = it;

      var check = document.createElement('span');
      check.className = 'ns-mi-check';
      row.appendChild(check);

      var label = document.createElement('span');
      label.className = 'ns-mi-label';
      label.innerHTML = it.label;
      row.appendChild(label);

      var accel = document.createElement('span');
      accel.className = 'ns-mi-accel';
      accel.textContent = accelText(it.accel);
      row.appendChild(accel);

      if (isSub(it)) {
        var arrow = document.createElement('span');
        arrow.className = 'ns-mi-sub';
        row.appendChild(arrow);
      }

      var enabled = it.enabled ? !!it.enabled() : true;
      if (!enabled) row.classList.add('is-disabled');
      if (it.type === 'check' && it.checked && it.checked()) row.classList.add('is-checked');

      row.addEventListener('mouseenter', function () { onItemHover(el, row); });
      row.addEventListener('click', function (e) {
        e.stopPropagation();
        activate(row);
      });
      el.appendChild(row);
    });
    return el;
  }

  function positionMenu(el, x, y, alignRight) {
    el.style.left = '0px';
    el.style.top = '0px';
    el.style.visibility = 'hidden';
    document.body.appendChild(el);
    var w = el.offsetWidth, h = el.offsetHeight;
    if (alignRight) x -= w;
    if (x + w > window.innerWidth) x = Math.max(0, window.innerWidth - w);
    if (y + h > window.innerHeight) y = Math.max(0, window.innerHeight - h);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.visibility = '';
  }

  /* ---------------- open / close ---------------- */

  function popup(defs, x, y, opts) {
    opts = opts || {};
    beginOverlay();
    return resolveItems(defs).then(function (items) {
      var el = buildMenuEl(items);
      positionMenu(el, x, y, opts.alignRight);
      menus.push(el);
      wireMenuKeys(el);
      syncOverlay();
      return el;
    });
  }

  function closeFrom(depth) {
    while (menus.length > depth) {
      var el = menus.pop();
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    syncOverlay();
    if (!menus.length) setOpenIndex(-1);
  }

  function closeAll() {
    openSeq++;
    clearTimeout(subTimer);
    closeFrom(0);
  }

  function setOpenIndex(i) {
    openIndex = i;
    var items = bar ? bar.children : [];
    for (var k = 0; k < items.length; k++) {
      items[k].classList.toggle('is-open', k === i);
    }
  }

  function openTopMenu(i) {
    var seq = ++openSeq;
    clearTimeout(subTimer);
    closeFrom(0);
    setOpenIndex(i);
    beginOverlay();
    var barItem = bar.children[i];
    var def = barItem._def;
    resolveItems(def.items).then(function (items) {
      if (seq !== openSeq) return; // superseded while resolving
      var r = barItem.getBoundingClientRect();
      var el = buildMenuEl(items);
      positionMenu(el, r.left, r.bottom, false);
      menus.push(el);
      wireMenuKeys(el);
      syncOverlay();
    });
  }

  function toggleTopMenu(i) {
    if (openIndex === i) closeAll(); else openTopMenu(i);
  }

  /* ---------------- item interaction ---------------- */

  function itemsOf(menuEl) {
    return Array.prototype.filter.call(menuEl.children, function (c) {
      return c.classList.contains('w95-menuitem');
    });
  }

  function highlight(menuEl, row) {
    itemsOf(menuEl).forEach(function (c) { c.classList.toggle('is-active', c === row); });
  }

  function onItemHover(menuEl, row) {
    var depth = menus.indexOf(menuEl);
    if (depth < 0) return;
    highlight(menuEl, row);
    clearTimeout(subTimer);
    var it = row._def;
    if (isSub(it) && !row.classList.contains('is-disabled')) {
      subTimer = setTimeout(function () { openSubmenu(depth, row); }, SUBMENU_DELAY);
    } else {
      closeFrom(depth + 1);
    }
  }

  function openSubmenu(depth, row) {
    var it = row._def;
    if (!isSub(it)) return;
    var seq = ++openSeq;
    resolveItems(it.items).then(function (items) {
      if (seq !== openSeq || menus[depth] !== row.parentNode) return;
      closeFrom(depth + 1);
      var r = row.getBoundingClientRect();
      var el = buildMenuEl(items);
      positionMenu(el, r.right - 2, r.top - 2, false);
      menus.push(el);
      wireMenuKeys(el);
      syncOverlay();
    });
  }

  function activate(row) {
    if (!row || row.classList.contains('is-disabled')) return;
    var it = row._def;
    if (isSub(it)) {
      var depth = menus.indexOf(row.parentNode);
      if (depth >= 0) openSubmenu(depth, row);
      return;
    }
    closeAll();
    if (it.run) it.run();
    else if (it.id) ctx.command(it.id, it.arg);
  }

  /* ---------------- keyboard ---------------- */

  function moveHighlight(menuEl, dir) {
    var items = itemsOf(menuEl);
    if (!items.length) return;
    var cur = items.findIndex(function (c) { return c.classList.contains('is-active'); });
    var n = cur;
    for (var k = 0; k < items.length; k++) {
      n = (n + dir + items.length) % items.length;
      if (!items[n].classList.contains('is-disabled')) break;
    }
    highlight(menuEl, items[n]);
  }

  function topMenuCount() { return bar ? bar.children.length : 0; }

  function onMenuKey(e) {
    var top = menus[menus.length - 1];
    var active = top && itemsOf(top).find(function (c) { return c.classList.contains('is-active'); });
    switch (e.key) {
      case 'Escape':
        if (menus.length > 1) closeFrom(menus.length - 1);
        else closeAll();
        e.preventDefault();
        break;
      case 'ArrowDown':
        if (menus.length) moveHighlight(top, 1);
        else if (openIndex >= 0) openTopMenu(openIndex);
        e.preventDefault();
        break;
      case 'ArrowUp':
        if (menus.length) moveHighlight(top, -1);
        e.preventDefault();
        break;
      case 'ArrowRight':
        if (active && isSub(active._def) && !active.classList.contains('is-disabled')) {
          openSubmenu(menus.length - 1, active);
        } else if (openIndex >= 0) {
          openTopMenu((openIndex + 1) % topMenuCount());
        }
        e.preventDefault();
        break;
      case 'ArrowLeft':
        if (menus.length > 1) {
          closeFrom(menus.length - 1);
        } else if (openIndex >= 0) {
          openTopMenu((openIndex - 1 + topMenuCount()) % topMenuCount());
        }
        e.preventDefault();
        break;
      case 'Enter':
        if (active) activate(active);
        e.preventDefault();
        break;
      default:
        if (e.key && e.key.length === 1 && top) {
          var ch = e.key.toLowerCase();
          var hit = itemsOf(top).find(function (c) {
            return mnemonicOf(c._def.label) === ch && !c.classList.contains('is-disabled');
          });
          if (hit) { highlight(top, hit); activate(hit); }
        }
        break;
    }
  }

  function wireMenuKeys() { /* handled by the single document keydown listener */ }

  function onKeyDown(e) {
    // Alt+mnemonic opens a top-level menu.
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key && e.key.length === 1) {
      var ch = e.key.toLowerCase();
      var items = bar ? bar.children : [];
      for (var i = 0; i < items.length; i++) {
        if (mnemonicOf(items[i]._def.label) === ch) {
          e.preventDefault();
          toggleTopMenu(i);
          return;
        }
      }
      return;
    }
    if (openIndex >= 0 || menus.length) onMenuKey(e);
  }

  function onDocMouseDown(e) {
    if (!menus.length && openIndex < 0) return;
    if (e.target.closest && (e.target.closest('.w95-menu') || e.target.closest('.w95-menubar-item'))) return;
    closeAll();
  }

  /* ---------------- init ---------------- */

  function init(context) {
    ctx = context;
    bar = document.getElementById('menubar');
    menuDefs().forEach(function (def, i) {
      var el = document.createElement('span');
      el.className = 'w95-menubar-item';
      el.innerHTML = def.label;
      el._def = def;
      el.addEventListener('mousedown', function (e) {
        e.preventDefault();
        toggleTopMenu(i);
      });
      el.addEventListener('mouseenter', function () {
        if (openIndex >= 0 && openIndex !== i) openTopMenu(i);
      });
      bar.appendChild(el);
    });
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onDocMouseDown, true);
    // Hiding/showing the native content view bounces focus, which fires blur on
    // this window. Only a blur that actually leaves the window closes the menu.
    window.addEventListener('blur', function () {
      setTimeout(function () { if (!document.hasFocus()) closeAll(); }, 0);
    });
  }

  window.NSMenu = { init: init, popup: popup, closeAll: closeAll };
})();
