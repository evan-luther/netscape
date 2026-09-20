/* Bookmarks window — folder tree over the flat Bookmark[] store.
 * Folders are Bookmark entries with url === '' (Navigator-style folder rows);
 * folders implied by a `folder` path but with no entry can't be edited/deleted.
 */
(function () {
  'use strict';
  var $ = dlg.$;
  dlg.initWindow();

  var ICONS = {
    bookmark: '../../assets/icons/bookmark.svg',
    folder: '../../assets/icons/folder.svg'
  };

  var tree = { root: null, at: function () {} };
  var expanded = new Set();
  var selected = null;
  function activate(node) {
    if (node.isFolder) return;
    if (node.entry && node.entry.url) nsd.command('bookmarks.open', node.entry.id);
  }

  dlg.keys({
    onEscape: function () { if (editing) hideEdit(); else nsd.close(); },
    onEnter: function () {
      if (editing) { $('#ed-ok').click(); return; }
      if (selected) activate(selected);
    }
  });

  function selectedFolderPath() {
    if (!selected) return '';
    return selected.isFolder ? selected.path : (selected.entry.folder || '');
  }

  function render() {
    dlg.buildTree($('#tree'), tree.root, {
      expanded: expanded,
      selected: selected,
      onSelect: function (node) {
        selected = node;
        var e = node.entry;
        $('#status').textContent = node.isFolder
          ? 'Folder: ' + node.label
          : (e.url + (e.lastVisited ? '  —  Last visited: ' + dlg.fmtDate(e.lastVisited) : ''));
      },
      onActivate: activate
    });
  }

  function load() {
    nsd.bookmarks.list().then(function (list) {
      tree = dlg.folderTree(list, ICONS);
      render();
    });
  }

  /* ---- inline edit bar ---- */
  function showEdit(mode, node) {
    editing = { mode: mode, node: node };
    $('#editbar').style.display = '';
    var isFolder = mode === 'add-folder' || (node && node.isFolder);
    $('#ed-url-row').style.display = isFolder ? 'none' : '';
    $('#ed-name').value = node ? node.label : '';
    $('#ed-url').value = node && node.entry ? node.entry.url : '';
    $('#ed-name').focus();
    $('#ed-name').select();
  }
  function hideEdit() {
    editing = null;
    $('#editbar').style.display = 'none';
  }

  $('#ed-ok').addEventListener('click', function () {
    if (!editing) return;
    var name = $('#ed-name').value.trim();
    var url = $('#ed-url').value.trim();
    var done = function () { hideEdit(); load(); };
    if (editing.mode === 'edit' && editing.node && editing.node.entry) {
      var patch = { title: name };
      if (!editing.node.isFolder) patch.url = url;
      nsd.bookmarks.update(editing.node.entry.id, patch).then(done);
    } else if (editing.mode === 'add-folder') {
      if (!name) return;
      nsd.bookmarks.add({ title: name, url: '' })
        .then(function (b) { return nsd.bookmarks.update(b.id, { folder: selectedFolderPath() }); })
        .then(done);
    } else { // add-bookmark
      if (!name && !url) return;
      nsd.bookmarks.add({ title: name || url, url: url })
        .then(function (b) {
          var f = selectedFolderPath();
          return f ? nsd.bookmarks.update(b.id, { folder: f }) : b;
        })
        .then(done);
    }
  });
  $('#ed-cancel').addEventListener('click', hideEdit);

  function removeSelected() {
    if (!selected || !selected.entry) return;
    nsd.bookmarks.remove(selected.entry.id).then(function () {
      selected = null;
      $('#status').textContent = '';
      load();
    });
  }

  /* ---- menus ---- */
  $('#menubar').appendChild(dlg.menubar([
    {
      label: 'File',
      items: [
        { label: 'Close', accel: 'Ctrl+W', onSelect: function () { nsd.close(); } }
      ]
    },
    {
      label: 'Edit',
      items: [
        { label: 'Delete', accel: 'Del', onSelect: removeSelected }
      ]
    },
    {
      label: 'Item',
      items: [
        { label: 'Insert Bookmark...', onSelect: function () { showEdit('add-bookmark'); } },
        { label: 'Insert Folder...', onSelect: function () { showEdit('add-folder'); } },
        '-',
        {
          label: 'Edit Bookmark...',
          onSelect: function () {
            if (selected && selected.entry) showEdit('edit', selected);
          }
        },
        {
          label: 'Open Bookmark',
          onSelect: function () {
            if (selected && !selected.isFolder && selected.entry) {
              nsd.command('bookmarks.open', selected.entry.id);
            }
          }
        }
      ]
    }
  ]));

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Delete' && !editing) removeSelected();
  });

  $('#close').addEventListener('click', function () { nsd.close(); });
  nsd.on('bookmarks:changed', load);
  load();
})();
