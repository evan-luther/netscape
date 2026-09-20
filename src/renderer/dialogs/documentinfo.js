/* Document Info — upper pane lists the document and its frames, lower pane
 * shows the document's metadata rows, all from nsd.params(). */
(function () {
  'use strict';
  var $ = dlg.$, el = dlg.el;
  dlg.initWindow();
  dlg.keys();

  var FIELDS = [
    ['Location', ['location', 'url']],
    ['File MIME Type', ['mimeType', 'contentType', 'mime']],
    ['Source', ['source']],
    ['Local cache file', ['cacheFile', 'localCacheFile']],
    ['Last Modified', ['lastModified']],
    ['Content Length', ['contentLength']],
    ['Expires', ['expires']],
    ['Charset', ['charset', 'characterSet']],
    ['Security', ['security']]
  ];

  function pick(p, keys) {
    for (var i = 0; i < keys.length; i++) {
      if (p[keys[i]] != null && p[keys[i]] !== '') return p[keys[i]];
    }
    return null;
  }

  nsd.params().then(function (p) {
    p = p || {};

    var frames = $('#frames');
    var docs = [{ title: p.title || 'Document', url: p.url || p.location || '' }];
    (p.frames || []).forEach(function (f) {
      docs.push({ title: f.title || 'Frame', url: f.url || f.location || '' });
    });
    docs.forEach(function (d, i) {
      var row = el('div', 'w95-listitem' + (i === 0 ? ' is-selected' : ''));
      var img = el('img');
      img.src = '../../assets/icons/document.svg';
      img.width = 16; img.height = 16; img.alt = '';
      row.appendChild(img);
      row.appendChild(el('span', null, ' ' + d.title + '  ' + d.url));
      frames.appendChild(row);
    });

    var rows = $('#rows');
    FIELDS.forEach(function (f) {
      var v = pick(p, f[1]);
      rows.appendChild(el('span', 'di-k', f[0] + ':'));
      rows.appendChild(el('span', 'di-v', v == null ? 'Unknown' : String(v)));
    });
  });

  $('#close').addEventListener('click', function () { nsd.close(); });
})();
