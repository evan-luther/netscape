'use strict';
// Native application menu, structured as Navigator 3.04 Gold:
// File Edit View Go Bookmarks Options Directory Window Help
// Accelerators still fire while the HTML menu bar is what the user sees.

const { Menu, app } = require('electron');
const commands = require('./commands');
const store = require('./store');
const { NavigatorWindow } = require('./window');

const DIRECTORY_KEYS = ['netscapeHome', 'whatsNew', 'whatsCool', 'destinations', 'netSearch', 'people', 'software'];
const DIRECTORY_LABELS = {
  netscapeHome: 'Netscape Home', whatsNew: "What's New?", whatsCool: "What's Cool?",
  destinations: 'Internet Destinations', netSearch: 'Internet Search',
  people: 'People', software: 'Software',
};

function cmd(id, arg) {
  return () => commands.run(id, NavigatorWindow.focused(), arg);
}

function goMenu() {
  const items = [
    { label: 'Back', accelerator: 'Alt+Left', click: cmd('go.back') },
    { label: 'Forward', accelerator: 'Alt+Right', click: cmd('go.forward') },
    { label: 'Home', accelerator: 'Alt+Home', click: cmd('go.home') },
    { label: 'Stop Loading', accelerator: 'Escape', click: cmd('go.stop') },
    { type: 'separator' },
    { label: 'History...', click: cmd('go.history') },
    { type: 'separator' },
  ];
  const win = NavigatorWindow.focused();
  if (win) {
    const entries = win.view.webContents.navigationHistory.getAllEntries();
    const active = win.view.webContents.navigationHistory.getActiveIndex();
    for (const e of entries.slice(-15)) {
      items.push({
        label: (e.title || e.url || '(untitled)').slice(0, 60),
        type: 'radio',
        checked: entries.indexOf(e) === active,
        click: cmd('go.entry', entries.indexOf(e)),
      });
    }
  }
  return items;
}

function bookmarksMenu() {
  const items = [
    { label: 'Add Bookmark', accelerator: 'CmdOrCtrl+D', click: cmd('bookmarks.add') },
    { label: 'View Bookmarks...', accelerator: 'CmdOrCtrl+B', click: cmd('bookmarks.view') },
    { type: 'separator' },
  ];
  const list = store.bookmarks().slice(-30);
  if (!list.length) items.push({ label: '(No Bookmarks)', enabled: false });
  for (const b of list) {
    items.push({ label: (b.title || b.url).slice(0, 60), click: cmd('bookmarks.open', b.id) });
  }
  return items;
}

function windowMenu() {
  const items = [
    { label: 'Bookmarks', click: cmd('window.bookmarks') },
    { label: 'History', click: cmd('window.history') },
    { label: 'Downloads', click: cmd('window.downloads') },
    { label: 'Address Book', click: cmd('window.addressBook') },
    { type: 'separator' },
  ];
  let i = 0;
  for (const nav of NavigatorWindow.all) {
    const title = nav.view.webContents.getTitle() || nav.view.webContents.getURL() || 'Netscape';
    const w = nav.win;
    items.push({ label: `${++i}. ${title}`.slice(0, 60), click: () => w.focus() });
  }
  return items;
}

function build() {
  const prefs = store.prefs();
  const template = [];

  if (process.platform === 'darwin') {
    template.push({
      label: app.name,
      submenu: [
        { label: 'About Netscape Navigator', click: cmd('help.about') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit Netscape Navigator', accelerator: 'Cmd+Q', click: cmd('file.exit') },
      ],
    });
  }

  template.push(
    {
      label: 'File',
      submenu: [
        { label: 'New Navigator Window', accelerator: 'CmdOrCtrl+N', click: cmd('file.newWindow') },
        { type: 'separator' },
        { label: 'Open Location...', accelerator: 'CmdOrCtrl+L', click: cmd('file.openLocation') },
        { label: 'Open File...', accelerator: 'CmdOrCtrl+O', click: cmd('file.openFile') },
        { label: 'Save As...', accelerator: 'CmdOrCtrl+S', click: cmd('file.saveAs') },
        { type: 'separator' },
        { label: 'Page Setup...', click: cmd('file.pageSetup') },
        { label: 'Print...', accelerator: 'CmdOrCtrl+P', click: cmd('file.print') },
        { label: 'Print Preview', click: cmd('file.printPreview') },
        { type: 'separator' },
        { label: 'Close', accelerator: 'CmdOrCtrl+W', click: cmd('file.close') },
        { label: 'Exit', click: cmd('file.exit') },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: cmd('edit.undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Y', click: cmd('edit.redo') },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', click: cmd('edit.cut') },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', click: cmd('edit.copy') },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', click: cmd('edit.paste') },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: cmd('edit.selectAll') },
        { type: 'separator' },
        { label: 'Find...', accelerator: 'CmdOrCtrl+F', click: cmd('edit.find') },
        { label: 'Find Again', accelerator: 'CmdOrCtrl+G', click: cmd('edit.findAgain') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: cmd('view.reload') },
        { label: 'Reload (Bypass Cache)', accelerator: 'CmdOrCtrl+Shift+R', click: cmd('view.reloadForce') },
        { label: 'Load Images', click: cmd('view.loadImages') },
        { label: 'Refresh', click: cmd('view.refresh') },
        { type: 'separator' },
        { label: 'Document Source', accelerator: 'CmdOrCtrl+U', click: cmd('view.source') },
        { label: 'Document Info', click: cmd('view.documentInfo') },
        { type: 'separator' },
        { label: 'Navigation Toolbar', type: 'checkbox', checked: prefs.toolbars.navigation, click: cmd('view.toolbar') },
        { label: 'Location Toolbar', type: 'checkbox', checked: prefs.toolbars.location, click: cmd('view.location') },
        { label: 'Directory Buttons', type: 'checkbox', checked: prefs.toolbars.directory, click: cmd('view.directory') },
      ],
    },
    { label: 'Go', submenu: goMenu() },
    { label: 'Bookmarks', submenu: bookmarksMenu() },
    {
      label: 'Options',
      submenu: [
        { label: 'General Preferences...', click: cmd('options.general') },
        { label: 'Network Preferences...', click: cmd('options.network') },
        { label: 'Security Preferences...', click: cmd('options.security') },
        { type: 'separator' },
        { label: 'Auto Load Images', type: 'checkbox', checked: prefs.autoLoadImages, click: cmd('options.autoImages') },
        { type: 'separator' },
        { label: 'Show Navigation Toolbar', type: 'checkbox', checked: prefs.toolbars.navigation, click: cmd('options.showToolbar') },
        { label: 'Show Location Toolbar', type: 'checkbox', checked: prefs.toolbars.location, click: cmd('options.showLocation') },
        { label: 'Show Directory Buttons', type: 'checkbox', checked: prefs.toolbars.directory, click: cmd('options.showDirectory') },
        { type: 'separator' },
        { label: 'Java Console', click: cmd('options.javaConsole') },
      ],
    },
    {
      label: 'Directory',
      submenu: DIRECTORY_KEYS.map(k => ({ label: DIRECTORY_LABELS[k], click: cmd('directory.' + k) })),
    },
    { label: 'Window', submenu: windowMenu() },
    {
      label: 'Help',
      submenu: [
        { label: 'About Netscape...', click: cmd('help.about') },
        { label: 'About Plug-ins', click: cmd('help.aboutPlugins') },
        { type: 'separator' },
        { label: 'Release Notes', click: cmd('help.releaseNotes') },
      ],
    }
  );

  return Menu.buildFromTemplate(template);
}

function rebuild() {
  Menu.setApplicationMenu(build());
}

module.exports = { build, rebuild };
