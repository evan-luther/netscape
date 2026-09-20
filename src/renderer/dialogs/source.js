/* View-source window ("Netscape Editor" style). Read-only document source;
 * Save As resolves {saveAs: path} so the opener/main can write the file. */
(function () {
  'use strict';
  var $ = dlg.$;
  dlg.initWindow();
  dlg.keys();

  var area = $('#src');

  nsd.params().then(function (p) {
    p = p || {};
    if (p.url) $('#title').textContent = 'Source of ' + p.url;
    area.value = p.html != null ? p.html : '';
  });

  $('#menubar').appendChild(dlg.menubar([
    {
      label: 'File',
      items: [
        {
          label: 'Save As...',
          onSelect: function () {
            nsd.pick('file').then(function (path) {
              if (path) nsd.close({ saveAs: path });
            });
          }
        },
        '-',
        { label: 'Close', accel: 'Ctrl+W', onSelect: function () { nsd.close(); } }
      ]
    }
  ]));
})();
