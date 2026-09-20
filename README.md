# Netscape Navigator

An Electron browser with the Netscape Navigator 3.04 Gold / Windows 95 interface on Windows, macOS, and Linux.

Supports navigation, bookmarks, history, preferences, find-in-page, downloads, printing, view source, and DevTools. Uses separate windows rather than tabs. Composer, Mail, and News are not implemented; the Edit button opens view source.

## Download

[Download the latest release](https://github.com/evan-luther/netscape/releases/latest). This repository is private; downloads require GitHub access.

| Platform | Architectures | Packages |
| --- | --- | --- |
| macOS | Apple Silicon (arm64), Intel (x64) | DMG, ZIP |
| Windows | x64, arm64 | Installer, portable EXE, ZIP |
| Linux | x64, arm64 | AppImage, DEB, tar.gz |

Builds are unsigned and unnotarized. macOS may require approval in System Settings → Privacy & Security; Windows may show a SmartScreen warning.

## Run from source

Requires Node.js and npm.

```sh
npm ci
npm start
```

## Build

```sh
npm run icon
npm run dist:mac
npm run dist:win
npm run dist:linux
```

Packages are written to `dist/`. All targets have been built from macOS. Runtime checks covered macOS and Windows 11 ARM64; Linux builds have not been runtime-tested.

## Source layout

- `src/main/` — windows, commands, menus, storage, downloads, and IPC.
- `src/preload/` — context-isolated APIs for the browser UI and dialogs.
- `src/renderer/` — HTML/CSS interface, dialogs, and bundled homepage.
- `src/assets/icons/` — SVG toolbar icons and throbber.

Web pages run in a `WebContentsView`. Menus, toolbar buttons, and shortcuts dispatch through `src/main/commands.js`. Settings, bookmarks, and history are stored in `netscape.json` under Electron's application data directory.

## Credits

The bundled MS Sans Serif recreation is by [lou](https://fontstruct.com/fontstructions/show/1384746), licensed under CC BY-SA 3.0, with WOFF conversions from [98.css](https://github.com/jdan/98.css). License and attribution files are in `src/renderer/fonts/`.

Netscape and Netscape Navigator are trademarks of their respective owners. This project is unaffiliated.
