/* About Netscape dialog */
(function () {
  'use strict';
  var $ = dlg.$;
  dlg.initWindow();
  dlg.keys();

  nsd.params().then(function (p) {
    p = p || {};
    var v = p.versions || p;
    var parts = [];
    if (v.app) parts.push('App ' + v.app);
    if (v.chrome || v.chromium) parts.push('Chromium ' + (v.chrome || v.chromium));
    if (v.electron) parts.push('Electron ' + v.electron);
    if (v.node) parts.push('Node.js ' + v.node);
    if (v.v8) parts.push('V8 ' + v.v8);
    if (parts.length) $('#about-versions').textContent = parts.join(', ');
    var plat = p.platform || nsd.platform;
    var arch = p.arch || '';
    if (plat || arch) {
      $('#about-platform').textContent = 'Platform: ' + (plat || '') + (arch ? ' (' + arch + ')' : '');
    }
  });

  $('#ok').addEventListener('click', function () { nsd.close(); });
})();
