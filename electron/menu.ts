/**
 * The application menu.
 *
 * ⚠️ **The Edit menu is load-bearing, not decoration.** On macOS the
 * ⌘X / ⌘C / ⌘V / ⌘A / ⌘Z accelerators for native `<input>` and `<textarea>`
 * fields come from the application menu, not from the web page. Ship the
 * default menu-less shell and typing a task title has no clipboard and no undo,
 * which reads to a user as "the app is broken" rather than "the menu is
 * missing".
 *
 * ⚠️ **Known risk, with two pre-authorised fallbacks.**
 * `components/gantt/board.tsx` binds ⌘Z, ⌘⇧Z, ⌘C, ⌘V and ⌘K at the document
 * level for its own multi-select clipboard and undo stack. A native menu role
 * registers a real accelerator, so on macOS these roles may shadow the board's
 * document-level handlers. If they do, either:
 *
 *   1. replace `undo`, `redo`, `copy` and `paste` with plain items carrying
 *      explicit `click` handlers and NO `accelerator`, so the keystroke reaches
 *      the page and the menu item still works, or
 *   2. drop those four roles and keep only `cut` and `selectAll`, which the
 *      board does not bind.
 *
 * ⚠️ MEASURED: `registerAccelerator: false` is **not** a fix here. Electron's
 * own `electron.d.ts` annotates that option `@platform linux,win32`, so it does
 * nothing on macOS — which is this project's primary development platform.
 *
 * This cannot be settled from source and Playwright cannot settle it either:
 * synthetic keyboard events do not dispatch through a native menu. It is
 * verified by hand on macOS.
 */

import { Menu, app, type MenuItemConstructorOptions } from "electron";

export function installApplicationMenu(): void {
  const isMac = process.platform === "darwin";

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" } as MenuItemConstructorOptions] : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        // Hidden in a packaged build: a user who opens DevTools by accident
        // gets a pane they cannot interpret and cannot easily close.
        { role: "toggleDevTools", visible: !app.isPackaged },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    // No Help menu: there is no website, no support address and no update feed
    // to link to. An empty Help menu is worse than none.
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
