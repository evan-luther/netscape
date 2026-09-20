/* Open Location dialog — resolves {url} to the opener, which navigates. */
(function () {
  'use strict';
  var $ = dlg.$;
  dlg.initWindow();
  dlg.keys();

  var field = $('#loc');
  field.focus();

  $('#open').addEventListener('click', function () {
    var v = field.value.trim();
    if (v) nsd.close({ url: v });
  });
  $('#clear').addEventListener('click', function () {
    field.value = '';
    field.focus();
  });
  $('#browse').addEventListener('click', function () {
    nsd.pick('file').then(function (path) {
      if (path) field.value = path;
    });
  });
  $('#cancel').addEventListener('click', function () { nsd.close(); });
})();
