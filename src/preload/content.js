'use strict';
// Content-view preload. Page context gets nothing privileged; generated
// about:/data: pages can read window.__netscape for version info.

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('__netscape', {
  version: '3.04',
  electron: process.versions.electron,
  chromium: process.versions.chrome,
});
