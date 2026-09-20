/* Find dialog — routes the query to the owner Navigator window via the
 * edit.find command; match counts arrive on the 'find:result' channel. */
(function () {
  'use strict';
  var $ = dlg.$;
  dlg.initWindow();
  dlg.keys();

  var text = $('#find-text');
  var status = $('#find-status');

  nsd.params().then(function (p) {
    if (p && p.text) text.value = p.text;
    text.focus();
    text.select();
  });

  nsd.on('find:result', function (r) {
    if (!r) return;
    if (r.matches > 0) {
      status.textContent = r.matches + ' match' + (r.matches === 1 ? '' : 'es') +
        (r.active ? ' — match ' + r.active : '');
    } else {
      status.textContent = 'Search string not found.';
    }
  });

  $('#find-next').addEventListener('click', function () {
    var q = text.value;
    if (!q) { status.textContent = ''; return; }
    nsd.command('edit.find', {
      text: q,
      forward: $('#find-down').checked,
      matchCase: $('#find-case').checked
    });
  });

  $('#find-cancel').addEventListener('click', function () { nsd.close(); });
})();
