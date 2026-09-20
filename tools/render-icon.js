// Rasterize src/assets/icons/netscape-logo.svg into build/icon.png (1024) and
// the linux icon set in build/icons/. Run: electron tools/render-icon.js
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SVG = path.join(ROOT, 'src', 'assets', 'icons', 'netscape-logo.svg');
const SIZES = [1024, 512, 256, 128, 64, 48, 32, 16];

if (!fs.existsSync(SVG)) {
  console.error('render-icon: missing ' + SVG);
  process.exit(1);
}

app.whenReady().then(async () => {
  const svg = fs.readFileSync(SVG, 'utf8');
  const html = '<!doctype html><html><body style="margin:0">' + svg +
    '<style>svg{width:100vw;height:100vh;display:block;image-rendering:pixelated}</style>' +
    '</body></html>';
  const win = new BrowserWindow({
    show: false, transparent: true, width: 1024, height: 1024,
    webPreferences: { offscreen: true },
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  fs.mkdirSync(path.join(ROOT, 'build', 'icons'), { recursive: true });
  for (const size of SIZES) {
    win.setContentSize(size, size);
    // two frames so the renderer re-lays-out and paints at the new size
    await win.webContents.executeJavaScript(
      'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const png = (await win.capturePage()).toPNG();
    const out = size === 1024
      ? path.join(ROOT, 'build', 'icon.png')
      : path.join(ROOT, 'build', 'icons', size + 'x' + size + '.png');
    fs.writeFileSync(out, png);
    console.log('wrote ' + path.relative(ROOT, out));
  }
  app.quit();
}).catch((err) => {
  console.error('render-icon: ' + (err && err.stack || err));
  app.exit(1);
});
