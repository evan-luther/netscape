/* Address Book — the 'Address Book' bookmark folder rendered as a tree.
 * Users are bookmarks with mailto: URLs; lists are folder entries (url === '').
 * No mail integration — entries are stored, not sent to. */
(function () {
  'use strict';
  var $ = dlg.$;
  dlg.initWindow();

  dlg.keys({
    onEscape: function () { if (editing) hideEdit(); else nsd.close(); },
    onEnter: function () { if (editing) $('#ed-ok').click(); }
  });
  var ROOT = 'Address Book';
  var ICONS = {
    bookmark: '../../assets/icons/bookmark.svg',
    folder: '../../assets/icons/folder.svg'
  };

  var tree = { root: null, at: function () {} };
  var expanded = new Set();
  var selected = null;
  var editing = null; // {mode:'user'|'list', node}

  function render() {
    var container = $('#tree');
    var root = tree.at(ROOT);
    if (!root || (!root.folders.length && !root.items.length)) {
      container.innerHTML = '';
      container.appendChild(dlg.el('div', 'w95-tree-row', 'No entries.'));
      return;
    }
    dlg.buildTree(container, root, {
      expanded: expanded,
      selected: selected,
      onSelect: function (node) {
        selected = node;
        $('#status').textContent = node.isFolder
          ? 'List: ' + node.label
          : (node.entry.url || '');
      },
      onActivate: function () {}
    });
  }

  function load() {
    nsd.bookmarks.list().then(function (list) {
      tree = dlg.folderTree(list, ICONS);
      render();
    });
  }

  function showEdit(mode, node) {
    editing = { mode: mode, node: node };
    $('#editbar').style.display = '';
    $('#ed-email-row').style.display = mode === 'list' ? 'none' : '';
    $('#ed-name').value = node ? node.label : '';
    var url = node && node.entry ? node.entry.url : '';
    $('#ed-email').value = url.indexOf('mailto:') === 0 ? url.slice(7) : '';
    $('#ed-name').focus();
    $('#ed-name').select();
  }
  function hideEdit() {
    editing = null;
    $('#editbar').style.display = 'none';
  }

  function parentPath() {
    if (!selected) return ROOT;
    if (selected.isFolder) return selected.path;
    return (selected.entry && selected.entry.folder) || ROOT;
  }

  $('#ed-ok').addEventListener('click', function () {
    if (!editing) return;
    var name = $('#ed-name').value.trim();
    if (!name) return;
    var done = function () { hideEdit(); load(); };
    if (editing.node && editing.node.entry) {
      var patch = { title: name };
      if (!editing.node.isFolder) {
        patch.url = 'mailto:' + $('#ed-email').value.trim();
      }
      nsd.bookmarks.update(editing.node.entry.id, patch).then(done);
    } else if (editing.mode === 'list') {
      nsd.bookmarks.add({ title: name, url: '' })
        .then(function (b) { return nsd.bookmarks.update(b.id, { folder: parentPath() }); })
        .then(done);
    } else {
      nsd.bookmarks.add({ title: name, url: 'mailto:' + $('#ed-email').value.trim() })
        .then(function (b) { return nsd.bookmarks.update(b.id, { folder: parentPath() }); })
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

  $('#menubar').appendChild(dlg.menubar([
    {
      label: 'File',
      items: [
        { label: 'Close', accel: 'Ctrl+W', onSelect: function () { nsd.close(); } }
      ]
    },
    {
      label: 'Item',
      items: [
        { label: 'Add User', onSelect: function () { showEdit('user'); } },
        { label: 'Add List', onSelect: function () { showEdit('list'); } },
        '-',
        {
          label: 'Edit Entry',
          onSelect: function () {
            if (selected && selected.entry) {
              showEdit(selected.isFolder ? 'list' : 'user', selected);
            }
          }
        },
        { label: 'Delete', accel: 'Del', onSelect: removeSelected }
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
