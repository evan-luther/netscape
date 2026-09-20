/* Preferences — tabbed notebook bound to the Prefs shape.
 * OK applies + closes, Cancel discards, Apply applies and stays. */
(function () {
  'use strict';
  var $ = dlg.$, $$ = dlg.$$, el = dlg.el;
  dlg.initWindow();
  dlg.keys();

  var FONTS = ['Times New Roman', 'Georgia', 'Garamond', 'Arial', 'Helvetica',
    'Verdana', 'Trebuchet MS', 'Courier New', 'Courier', 'Lucida Console', 'Tahoma'];
  var SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36];
  var DIR_KEYS = ['netscapeHome', 'whatsNew', 'whatsCool', 'destinations',
    'netSearch', 'people', 'software'];

  var prefs = null;

  function fillSelect(sel, values, current) {
    sel.innerHTML = '';
    values.forEach(function (v) {
      var o = el('option', null, String(v));
      o.value = v;
      sel.appendChild(o);
    });
    if (current != null && values.indexOf(current) < 0) {
      var o = el('option', null, String(current));
      o.value = current;
      sel.appendChild(o);
    }
    if (current != null) sel.value = current;
  }

  function radio(name, value) {
    $$('input[name="' + name + '"]').forEach(function (r) {
      r.checked = r.value === String(value);
    });
  }
  function radioVal(name) {
    var r = $('input[name="' + name + '"]:checked');
    return r ? r.value : null;
  }
  function num(id) {
    var n = parseInt($(id).value, 10);
    return isNaN(n) ? 0 : n;
  }

  function loadInto(p) {
    prefs = p;
    radio('starts', p.startsWith);
    $('#p-homepage').value = p.homepage || '';
    radio('tbstyle', p.toolbars && p.toolbars.style);
    $('#p-underline').checked = !!p.underlineLinks;
    $('#p-images').checked = !!p.autoLoadImages;
    $('#p-search').value = p.searchUrl || '';

    fillSelect($('#p-serif'), FONTS, p.fonts && p.fonts.serif);
    fillSelect($('#p-sans'), FONTS, p.fonts && p.fonts.sansSerif);
    fillSelect($('#p-fixed'), FONTS, p.fonts && p.fonts.fixed);
    fillSelect($('#p-size'), SIZES, p.fonts && p.fonts.defaultSize);
    fillSelect($('#p-fixedsize'), SIZES, p.fonts && p.fonts.fixedSize);

    var c = p.colors || {};
    $('#c-link').value = c.link || '#0000ee';
    $('#c-visited').value = c.visited || '#551a8b';
    $('#c-text').value = c.text || '#000000';
    $('#c-bg').value = c.background || '#c0c0c0';
    $('#c-override').checked = c.useDocumentColors === false;

    var n = p.network || {};
    $('#n-memcache').value = (n.memCacheMB || 0) * 1024;
    $('#n-diskcache').value = (n.diskCacheMB || 0) * 1024;
    radio('proxy', n.proxyMode || 'none');
    $('#n-proxyhost').value = n.httpProxy || '';
    $('#n-proxyport').value = n.httpProxyPort || '';

    var s = p.security || {};
    $('#s-enter').checked = !!s.warnEnteringSecure;
    $('#s-leave').checked = !!s.warnLeavingSecure;
    $('#s-submit').checked = !!s.warnSubmitInsecure;
    radio('cookies', s.acceptCookies || 'always');

    var d = p.directory || {};
    DIR_KEYS.forEach(function (k) {
      $('input[data-dir="' + k + '"]').value = d[k] || '';
    });
  }

  function collect() {
    var dir = {};
    DIR_KEYS.forEach(function (k) {
      dir[k] = $('input[data-dir="' + k + '"]').value.trim();
    });
    return {
      homepage: $('#p-homepage').value.trim(),
      startsWith: radioVal('starts') || 'home',
      toolbars: {
        navigation: prefs && prefs.toolbars ? prefs.toolbars.navigation : true,
        location: prefs && prefs.toolbars ? prefs.toolbars.location : true,
        directory: prefs && prefs.toolbars ? prefs.toolbars.directory : true,
        style: radioVal('tbstyle') || 'both'
      },
      underlineLinks: $('#p-underline').checked,
      autoLoadImages: $('#p-images').checked,
      searchUrl: $('#p-search').value.trim(),
      fonts: {
        serif: $('#p-serif').value,
        sansSerif: $('#p-sans').value,
        fixed: $('#p-fixed').value,
        defaultSize: parseInt($('#p-size').value, 10) || 16,
        fixedSize: parseInt($('#p-fixedsize').value, 10) || 13
      },
      colors: {
        link: $('#c-link').value,
        visited: $('#c-visited').value,
        text: $('#c-text').value,
        background: $('#c-bg').value,
        useDocumentColors: !$('#c-override').checked
      },
      network: {
        memCacheMB: Math.round(num('#n-memcache') / 1024),
        diskCacheMB: Math.round(num('#n-diskcache') / 1024),
        proxyMode: radioVal('proxy') || 'none',
        httpProxy: $('#n-proxyhost').value.trim(),
        httpProxyPort: num('#n-proxyport')
      },
      security: {
        warnEnteringSecure: $('#s-enter').checked,
        warnLeavingSecure: $('#s-leave').checked,
        warnSubmitInsecure: $('#s-submit').checked,
        acceptCookies: radioVal('cookies') || 'always'
      },
      directory: dir
    };
  }

  function apply() {
    return nsd.prefs.set(collect()).then(function (p) { prefs = p || prefs; });
  }

  /* ---- tabs ---- */
  function activate(name) {
    $$('.w95-tab').forEach(function (t) {
      t.classList.toggle('is-active', t.getAttribute('data-tab') === name);
    });
    $$('.w95-tabpanel').forEach(function (p) {
      p.classList.toggle('is-active', p.getAttribute('data-tab') === name);
    });
  }
  $$('.w95-tab').forEach(function (t) {
    t.addEventListener('click', function () { activate(t.getAttribute('data-tab')); });
  });

  $('#ok').addEventListener('click', function () {
    apply().then(function () { nsd.close({ applied: true }); });
  });
  $('#cancel').addEventListener('click', function () { nsd.close(); });
  $('#apply').addEventListener('click', function () { apply(); });

  nsd.prefs.get().then(function (p) {
    loadInto(p || {});
    return nsd.params();
  }).then(function (params) {
    var page = params && (params.page || params.tab);
    activate(page && $('.w95-tab[data-tab="' + page + '"]') ? page : 'appearance');
  });
})();
