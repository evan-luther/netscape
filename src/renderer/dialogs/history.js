/* History dialog — sortable Title/Location/Last Visited list.
 * Double-click or "Go to" navigates the owner window via go.entry (index into
 * the newest-first history list). */
(function () {
  'use strict';
  var $ = dlg.$, $$ = dlg.$$, el = dlg.el;
  dlg.initWindow();
  dlg.keys();

  var entries = [];        // newest-first, as returned by nsd.history.list()
  var selected = -1;       // index into entries
  var sortKey = null, sortAsc = true;
  var rowsEl = $('#rows');

  function render() {
    rowsEl.innerHTML = '';
    var order = entries.map(function (e, i) { return i; });
    if (sortKey) {
      order.sort(function (a, b) {
        var x = entries[a][sortKey], y = entries[b][sortKey];
        if (sortKey === 'visited') return sortAsc ? x - y : y - x;
        x = (x || '').toLowerCase(); y = (y || '').toLowerCase();
        return sortAsc ? (x < y ? -1 : x > y ? 1 : 0) : (x < y ? 1 : x > y ? -1 : 0);
      });
    }
    order.forEach(function (i) {
      var e = entries[i];
      var row = el('div', 'lst-row' + (i === selected ? ' is-selected' : ''));
      row.appendChild(el('span', null, e.title || '(untitled)'));
      row.appendChild(el('span', null, e.url));
      row.appendChild(el('span', null, dlg.fmtDate(e.visited)));
      row.addEventListener('click', function () { select(i); });
      row.addEventListener('dblclick', function () { goTo(i); });
      rowsEl.appendChild(row);
    });
  }

  function select(i) {
    selected = i;
    render();
    $('#goto').disabled = $('#mkbookmark').disabled = i < 0;
  }

  function goTo(i) {
    if (i < 0) return;
    nsd.command('navigate', entries[i].url);
  }


  function load() {
    nsd.history.list().then(function (list) {
      entries = list || [];
      selected = -1;
      render();
      $('#goto').disabled = $('#mkbookmark').disabled = true;
    });
  }

  $$('#head span').forEach(function (h) {
    h.addEventListener('click', function () {
      var k = h.getAttribute('data-key');
      if (sortKey === k) sortAsc = !sortAsc; else { sortKey = k; sortAsc = true; }
      render();
    });
  });

  $('#goto').addEventListener('click', function () { goTo(selected); });
  $('#mkbookmark').addEventListener('click', function () {
    var e = entries[selected];
    if (e) nsd.bookmarks.add({ title: e.title || e.url, url: e.url });
  });
  $('#clear').addEventListener('click', function () {
    if (confirm('Clear all history entries?')) {
      nsd.history.clear().then(load);
    }
  });
  $('#close').addEventListener('click', function () { nsd.close(); });

  nsd.on('history:changed', load);
  load();
})();
