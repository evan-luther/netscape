/* chrome.js — Navigator 3.04 window chrome wiring.
   Talks to main exclusively through window.ns (src/preload/chrome.js).
   Standalone-safe: opening chrome.html in a plain browser must not throw,
   so every ns.* member used below exists on the shim. */
(function () {
  'use strict';

  var noop = function () {};
  var noopP = function (v) { return function () { return Promise.resolve(v); }; };

  var ns = window.ns || {
    platform: 'linux',
    windowId: 0,
    on: function () { return noop; },
    command: noopP(undefined),
    navigate: noopP(undefined),
    setContentBounds: noop,
    setChromeMetrics: noop,
    content: { freeze: noopP(null), setVisible: noopP(undefined) },
    prefs: { get: noopP(null), set: noopP(null) },
    bookmarks: { list: noopP([]), add: noopP(null), remove: noopP(undefined), update: noopP(null) },
    history: { list: noopP([]), clear: noopP(undefined) },
    find: noopP(undefined),
    findStop: noopP(undefined),
    contextMenu: noopP(undefined),
    win: { minimize: noop, maximize: noop, close: noop,
           bounds: noopP(null), setBounds: noopP(undefined), isMaximized: noopP(false) },
    dialog: { open: noopP(null) },
    zoom: noopP(undefined)
  };

  var $ = function (id) { return document.getElementById(id); };

  var titlebar = $('titlebar');
  var titleText = $('titleText');
  var titleIcon = $('titleIcon');
  var navBar = $('navBar');
  var locBar = $('locBar');
  var dirBar = $('dirBar');
  var locField = $('locField');
  var locLabel = $('locLabel');
  var locDrop = $('locDrop');
  var content = $('content');
  var statusText = $('statusText');
  var progress = $('progress');
  var keyIcon = $('keyIcon');
  var keyTip = $('keyTip');
  var keyPanel = $('keyPanel');
  var throbber = $('throbber');
  var throbberImg = $('throbberImg');
  var tbBack = $('tbBack');
  var tbForward = $('tbForward');
  var tbStop = $('tbStop');

  var ICONS = '../assets/icons/';

  var state = {
    url: '', title: '', canGoBack: false, canGoForward: false,
    loading: false, secure: false, netsite: false, zoom: 0,
    entries: [], activeIndex: -1,
    findPerformed: false
  };
  var prefs = {
    toolbars: { navigation: true, location: true, directory: true, style: 'both' },
    autoLoadImages: true
  };
  var locDirty = false;

  /* ---------------- content bounds ---------------- */

  function reportBounds() {
    var r = content.getBoundingClientRect();
    ns.setContentBounds({
      x: Math.round(r.x), y: Math.round(r.y),
      width: Math.round(r.width), height: Math.round(r.height)
    });
  }

  if (window.ResizeObserver) {
    new ResizeObserver(reportBounds).observe(content);
  }
  window.addEventListener('resize', reportBounds);
  window.addEventListener('load', reportBounds);

  /* ---------------- content freeze (so popups can paint over the page) ----
     The page lives in a native view stacked above this document, so an open
     menu would be clipped. Swap the live view for a still of it: the still
     covers the whole border box (the native view covers the border too), and
     is decoded and painted before the view hides, so there is no flash. */

  var freezeLayer = document.createElement('div');
  freezeLayer.id = 'contentFreeze';
  content.appendChild(freezeLayer);

  var freezeWant = false, freezeIs = false, freezeBusy = false;

  function twoFrames() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () { requestAnimationFrame(resolve); });
    });
  }

  function showStill(dataUrl) {
    if (!dataUrl) return Promise.resolve();
    var img = new Image();
    img.src = dataUrl;
    var decoded = img.decode ? img.decode() : Promise.resolve();
    return decoded.catch(function () {}).then(function () {
      freezeLayer.style.backgroundImage = 'url("' + dataUrl + '")';
      freezeLayer.classList.add('is-on');
      return twoFrames();
    });
  }

  function applyFreeze() {
    if (freezeBusy || freezeWant === freezeIs) return;
    freezeBusy = true;
    var target = freezeWant;
    var step = target
      ? ns.content.freeze()
          .then(showStill)
          .then(function () { return ns.content.setVisible(false); })
      : ns.content.setVisible(true)
          .then(twoFrames)
          .then(function () {
            freezeLayer.classList.remove('is-on');
            freezeLayer.style.backgroundImage = '';
          });
    step.catch(function () {}).then(function () {
      freezeIs = target;
      freezeBusy = false;
      applyFreeze();
    });
  }

  function freezeContent() { freezeWant = true; applyFreeze(); }
  function thawContent() { freezeWant = false; applyFreeze(); }

  /* ---------------- title bar ---------------- */

  function setTitle(title) {
    var t = title ? title + ' - Netscape' : 'Netscape';
    titleText.textContent = t;
    document.title = t;
  }

  var btnMax = $('btnMax');

  /* win32 frameless+thickFrame maximize is unreliable: the OS places the
     window at -8,-8 (caption buttons end up half off-screen) and
     isMaximized() can disagree with the visible state, which makes the
     main-side toggle call maximize() again — a no-op that looks like a
     dead button. So we track the state ourselves: maximize fills the work
     area via setBounds, restore returns to the remembered rect. The
     native path is only used to undo a real OS-level maximize. */
  var maxed = false;        // our own maximize bookkeeping
  var normalBounds = null;  // rect to restore to

  function fillsWorkArea(b) {
    // ponytail: window.screen is the primary display; multi-monitor edge
    // cases fall back to the native path anyway.
    return !!b && b.x <= screen.availLeft && b.y <= screen.availTop &&
      b.x + b.width >= screen.availLeft + screen.availWidth &&
      b.y + b.height >= screen.availTop + screen.availHeight;
  }

  function syncMaxButton() {
    Promise.all([ns.win.isMaximized(), ns.win.bounds()]).then(function (r) {
      if (r[1] && !fillsWorkArea(r[1])) maxed = false;
      var restore = !!r[0] || maxed || fillsWorkArea(r[1]);
      btnMax.classList.toggle('restore', restore);
      btnMax.classList.toggle('max', !restore);
      btnMax.title = restore ? 'Restore' : 'Maximize';
    });
  }

  var isMac = ns.platform === 'darwin';

  function toggleMax() {
    Promise.all([ns.win.isMaximized(), ns.win.bounds()]).then(function (r) {
      var native = r[0], b = r[1];
      /* macOS: real zoom toggles reliably (unmaximize restores the user
         rect); a manual fill-screen setBounds only trips isZoomed without
         a restorable rect, and setBounds is then blocked — a trap. */
      if (isMac || native) { maxed = false; ns.win.maximize(); return; }
      if (maxed || fillsWorkArea(b)) {
        /* ---- restore ---- */
        maxed = false;
        ns.win.setBounds(normalBounds || {
          x: screen.availLeft + 40, y: screen.availTop + 40,
          width: screen.availWidth - 80, height: screen.availHeight - 80
        });
        return;
      }
      /* ---- maximize: fill the work area ourselves. Native maximize on
         win32 frameless+thickFrame lands at -8,-8 (caption buttons half
         off-screen) and isMaximized() can disagree with the visible
         state, which makes the main-side toggle call maximize() again —
         a no-op that looks like a dead button. */
      normalBounds = b;
      maxed = true;
      ns.win.setBounds({
        x: screen.availLeft, y: screen.availTop,
        width: screen.availWidth, height: screen.availHeight
      });
    });
  }
  /* The window can be created larger than the screen (1024x768 default on
     an 800x600 display): the right/bottom edges — and the resize zones
     glued to them — end up off-screen and unreachable. Clamp once at
     startup so every edge stays on the work area. */
  function clampToWorkArea() {
    ns.win.isMaximized().then(function (m) {
      if (m) return;
      ns.win.bounds().then(function (b) {
        if (!b) return;
        var w = Math.min(b.width, screen.availWidth);
        var h = Math.min(b.height, screen.availHeight);
        var x = Math.min(Math.max(b.x, screen.availLeft), screen.availLeft + screen.availWidth - w);
        var y = Math.min(Math.max(b.y, screen.availTop), screen.availTop + screen.availHeight - h);
        if (x !== b.x || y !== b.y || w !== b.width || h !== b.height) {
          ns.win.setBounds({ x: x, y: y, width: w, height: h });
        }
      });
    });
  }

  $('btnMin').addEventListener('click', function () { ns.win.minimize(); });
  btnMax.addEventListener('click', toggleMax);
  $('btnClose').addEventListener('click', function () { ns.win.close(); });
  titlebar.addEventListener('dblclick', function (e) {
    if (e.target.closest('.w95-tbtn')) return;
    toggleMax();
  });
  window.addEventListener('resize', syncMaxButton);
  syncMaxButton();
  clampToWorkArea();

  window.addEventListener('blur', function () { titlebar.classList.add('is-inactive'); });
  window.addEventListener('focus', function () { titlebar.classList.remove('is-inactive'); });

  /* ---------------- frameless resize ----------------
     Windows gives frameless windows no OS resize border, so edges/corners
     and the status-bar grip drive ns.win.setBounds() from here. */

  var MIN_W = 420, MIN_H = 300;

  function startResize(el, dir) {
    el.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      ns.win.isMaximized().then(function (max) {
        if (max || maxed) return;
        return ns.win.bounds().then(function (b) {
          if (!b) return;
          var sx = e.screenX, sy = e.screenY, pending = null, rafId = 0;
          function flush() {
            rafId = 0;
            if (pending) { var r = pending; pending = null; ns.win.setBounds(r); }
          }
          function move(ev) {
            var dx = ev.screenX - sx, dy = ev.screenY - sy;
            var r = { x: b.x, y: b.y, width: b.width, height: b.height };
            if (dir.indexOf('e') !== -1) r.width = b.width + dx;
            if (dir.indexOf('s') !== -1) r.height = b.height + dy;
            if (dir.indexOf('w') !== -1) { r.x = b.x + dx; r.width = b.width - dx; }
            if (dir.indexOf('n') !== -1) { r.y = b.y + dy; r.height = b.height - dy; }
            if (r.width < MIN_W) { if (dir.indexOf('w') !== -1) r.x -= MIN_W - r.width; r.width = MIN_W; }
            if (r.height < MIN_H) { if (dir.indexOf('n') !== -1) r.y -= MIN_H - r.height; r.height = MIN_H; }
            /* keep the dragged edge on the work area — an edge pushed
               off-screen takes its resize zone with it and can never be
               grabbed again */
            if (dir.indexOf('e') !== -1) r.width = Math.min(r.width, screen.availLeft + screen.availWidth - r.x);
            if (dir.indexOf('s') !== -1) r.height = Math.min(r.height, screen.availTop + screen.availHeight - r.y);
            if (dir.indexOf('w') !== -1) { var nx = Math.max(r.x, screen.availLeft); r.width += r.x - nx; r.x = nx; }
            if (dir.indexOf('n') !== -1) { var ny = Math.max(r.y, screen.availTop); r.height += r.y - ny; r.y = ny; }
            pending = r;
            if (!rafId) rafId = requestAnimationFrame(flush);
          }
          function up() {
            el.removeEventListener('pointermove', move);
            el.removeEventListener('pointerup', up);
            el.removeEventListener('pointercancel', up);
            flush();
            reportBounds();
          }
          el.addEventListener('pointermove', move);
          el.addEventListener('pointerup', up);
          el.addEventListener('pointercancel', up);
        });
      });
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.ns-rz'), function (el) {
    startResize(el, el.dataset.rz);
  });
  startResize(document.querySelector('.w95-sizegrip'), 'se');

  /* ---------------- toolbar buttons ---------------- */

  Array.prototype.forEach.call(document.querySelectorAll('.ns-toolbtn'), function (btn) {
    btn.addEventListener('click', function () {
      if (!btn.classList.contains('is-disabled')) ns.command(btn.dataset.cmd);
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll('.ns-dirbtn'), function (btn) {
    btn.addEventListener('click', function () { ns.command('directory.' + btn.dataset.dir); });
  });

  throbber.addEventListener('click', function () { ns.command('nav.throbber'); });

  keyPanel.addEventListener('click', function () { ns.command('options.security'); });

  function setDisabled(el, off) { el.classList.toggle('is-disabled', !!off); }

  /* ---------------- nav state ---------------- */

  function applyNavState(s) {
    for (var k in s) state[k] = s[k];
    setTitle(state.title);
    setDisabled(tbBack, !state.canGoBack);
    setDisabled(tbForward, !state.canGoForward);
    setDisabled(tbStop, !state.loading);
    throbberImg.src = ICONS + (state.loading ? 'throbber.svg' : 'throbber-idle.svg');
    keyIcon.src = ICONS + (state.secure ? 'key-secure.svg' : 'key-broken.svg');
    keyTip.textContent = state.secure
      ? 'Netscape has detected a secure document'
      : 'Netscape has not detected a secure document';
    if (document.activeElement !== locField) locField.value = state.url;
    updateLocLabel();
  }

  /* ---------------- location field ---------------- */

  function updateLocLabel() {
    if (locDirty) locLabel.textContent = 'Go to:';
    else if (state.netsite) locLabel.textContent = 'Netsite:';
    else locLabel.textContent = 'Location:';
  }

  locField.addEventListener('input', function () {
    locDirty = locField.value !== state.url;
    updateLocLabel();
  });
  locField.addEventListener('focus', function () {
    locDirty = locField.value !== state.url;
    updateLocLabel();
  });
  locField.addEventListener('blur', function () {
    locDirty = false;
    updateLocLabel();
  });
  locField.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      var v = locField.value;
      locDirty = false;
      locField.blur();
      if (v) ns.navigate(v);
    } else if (e.key === 'Escape') {
      locField.value = state.url;
      locDirty = false;
      locField.blur();
      updateLocLabel();
      e.stopPropagation();
    }
  });

  locDrop.addEventListener('click', function () {
    var r = locDrop.getBoundingClientRect();
    ns.history.list().then(function (list) {
      var items = list.slice(0, 10).map(function (h) {
        return {
          label: String(h.title || h.url).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
          run: function () { ns.navigate(h.url); }
        };
      });
      if (!items.length) items = [{ label: '(no recent locations)', enabled: function () { return false; } }];
      window.NSMenu.closeAll();
      window.NSMenu.popup(items, r.right, r.bottom + 1, { alignRight: true });
    });
  });

  /* ---------------- prefs / toolbar visibility ---------------- */

  var TOOLBARS = { navigation: navBar, location: locBar, directory: dirBar };

  function applyPrefs(p) {
    if (!p) return;
    prefs = p;
    var tb = p.toolbars || {};
    var changed = false;
    for (var key in TOOLBARS) {
      var want = tb[key] !== false;
      if (TOOLBARS[key].hidden !== !want) { TOOLBARS[key].hidden = !want; changed = true; }
    }
    navBar.classList.remove('is-style-both', 'is-style-icons', 'is-style-text');
    navBar.classList.add('is-style-' + (tb.style || 'both'));
    if (changed) reportBounds();
  }

  function refreshToolbars() {
    // main persists the toggle before forwarding ui:command; re-read and apply.
    ns.prefs.get().then(applyPrefs);
  }

  /* ---------------- menu bar ---------------- */

  window.NSMenu.init({
    getState: function () { return state; },
    getPrefs: function () { return prefs; },
    bookmarks: function () { return ns.bookmarks.list(); },
    command: function (id, arg) { ns.command(id, arg); },
    freezeContent: freezeContent,
    thawContent: thawContent
  });

  /* ---------------- channels ---------------- */

  ns.on('nav:state', applyNavState);
  ns.on('nav:progress', function (p) {
    progress.style.setProperty('--w95-progress-value', Math.max(0, Math.min(100, p.percent)) + '%');
  });
  ns.on('nav:status', function (s) {
    statusText.textContent = s.text || 'Document: Done';
  });
  ns.on('nav:favicon', function (f) {
    titleIcon.src = f.dataUrl || ICONS + 'netscape-window.svg';
  });
  ns.on('ui:command', function (c) {
    switch (c.id) {
      case 'file.openLocation':
        locField.focus();
        locField.select();
        break;
      case 'view.toolbar': case 'options.showToolbar':
      case 'view.location': case 'options.showLocation':
      case 'view.directory': case 'options.showDirectory':
        refreshToolbars();
        break;
    }
  });
  ns.on('prefs:changed', function (p) { applyPrefs(p.prefs); });
  ns.on('download:update', function (d) {
    if (d.state === 'progressing' || d.state === 'started') {
      statusText.textContent = d.total > 0
        ? 'Receiving ' + d.filename + ' (' + Math.floor(d.received * 100 / d.total) + '%)'
        : 'Receiving ' + d.filename + ' (' + d.received + ' bytes)';
    }
  });
  ns.on('find:result', function () { state.findPerformed = true; });
  ns.on('history:changed', function () { window.NSMenu.closeAll(); });
  ns.on('bookmarks:changed', function () { window.NSMenu.closeAll(); });

  /* ---------------- startup ---------------- */

  document.body.classList.toggle('is-mac', ns.platform === 'darwin');
  ns.prefs.get().then(applyPrefs);
  applyNavState({});
  reportBounds();
})();
