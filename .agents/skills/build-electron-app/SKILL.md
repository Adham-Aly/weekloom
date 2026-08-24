---
name: build-electron-app
description: Build, package and launch Weekloom as a local Electron desktop app — the Next.js standalone build, the main-process TypeScript compile, electron-builder targets per platform, where each artifact lands, and how to verify the result actually starts and writes to ~/.weekloom. Use when asked to build, package, bundle, ship, produce an installer, DMG, AppImage or exe, or to run the desktop app rather than the dev server.
---

# Building and packaging Weekloom

## What you are building

Three artifacts, in this order. Each one depends on the previous.

| #   | artifact                | produced by                                       | what it is                                                                                                                                          |
| --- | ----------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `.next/standalone/`     | `npm run build` then `npm run prepare:standalone` | a self-contained Next.js server: `server.js`, its own `node_modules`, plus the `public/` and `.next/static` directories the build does **not** copy |
| 2   | `electron/dist/main.js` | `npm run build:electron`                          | the compiled desktop main process. `package.json`'s `main` points here                                                                              |
| 3   | `release/`              | `npm run package`                                 | the platform installer, configured by `electron-builder.yml`                                                                                        |

How they fit together at runtime:

```
electron/dist/main.js
  → mkdir ~/.weekloom
  → pick a free loopback port
  → spawn .next/standalone/server.js  (ELECTRON_RUN_AS_NODE=1, HOSTNAME=127.0.0.1, PORT=<port>)
  → poll http://127.0.0.1:<port>/api/health until 200
  → BrowserWindow → http://127.0.0.1:<port>/app
```

## Prerequisites

```bash
node --version     # must be v24 or newer
```

Below 24 you get `EBADENGINE` from npm and, if you push past it, a crash on the first database
access: the data layer uses Node's built-in `node:sqlite`, which older versions do not have.

If `node_modules/` is missing, run `npm ci`. **Never add a dependency to make a build work
without asking the user first** — `tests/no-cloud-imports.test.ts` enumerates the runtime
dependency list and will fail, deliberately, until somebody decides that on purpose.

electron-builder can only produce an artifact for the platform it runs on. On macOS you get the
`.dmg`/`.zip`; you cannot cross-compile the Windows or Linux ones from there.

## The commands, in order

```bash
npm run build              # 1. next build (output: "standalone")
npm run build:electron     # 2. tsc -p tsconfig.electron.json
npm run prepare:standalone # 3. copy public/ and .next/static beside server.js
```

Three shortcuts chain them:

```bash
npm run app:build     # all three above
npm run app:start     # app:build, then `electron .`
npm run package       # app:build, then electron-builder
```

For a local unsigned macOS build, skip the signing step:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run package
```

## Verifying the build before you report success

**This is the point of this skill.** A Weekloom build fails in ways that still produce a window,
so "it built" is not evidence. Run these, in this order.

```bash
# The server exists.
ls .next/standalone/server.js

# ⚠️ The two directories `output: "standalone"` does NOT copy. If either is missing,
# `prepare:standalone` did not run, and the app will launch UNSTYLED with every chunk 404ing.
ls .next/standalone/.next/static
ls .next/standalone/public/weekloom-logo.svg

# The desktop shell compiled.
ls electron/dist/main.js
```

Then launch it (`npm run app:start`) and confirm three things:

```bash
# 1. The database was created where it belongs.
ls -la ~/.weekloom/weekloom.db

# 2. ⚠️ The server is on LOOPBACK, not on every interface. This must print 127.0.0.1,
#    never `*`. If it prints `*`, HOSTNAME was dropped and the app is serving the
#    user's entire database to their whole network.
lsof -nP -iTCP -sTCP:LISTEN | grep -i electron

# 3. Closing the window leaves no orphan. This must print nothing.
pgrep -f "standalone/server.js"
```

And in the window itself: the board renders (not an error page), and creating a task works —
that last one exercises `crypto.randomUUID`, which is the canary for the secure-context trap
below.

For `npm run package`, additionally:

```bash
ls release/        # names an artifact for THIS platform
```

⚠️ **Then run the packaged server directly, before you install anything.** This is the single
highest-value check in this file, it takes five seconds, and it catches the one failure mode that
produces a perfectly valid-looking installer containing an application that cannot start:

```bash
APP="$PWD/release/mac-arm64/Weekloom.app/Contents"          # adjust per platform
TMP="$(mktemp -d)"
ELECTRON_RUN_AS_NODE=1 NODE_ENV=production PORT=3993 HOSTNAME=127.0.0.1 \
  WEEKLOOM_DATA_DIR="$TMP" "$APP/MacOS/Weekloom" "$APP/Resources/app/server.js"
# In another shell: curl -s http://127.0.0.1:3993/api/health   → {"ok":true}
```

That is exactly the command line `electron/main.ts`'s `startServer` builds, so anything it prints
is what the shell would have swallowed into a startup dialog. **MEASURED — this is not
hypothetical:** an `extraResources` block that copied `.next/standalone` but not its
`node_modules` produced a 197 MB DMG whose server died on its first statement with
`Error: Cannot find module 'next'`. `npm run package` exited 0 and said nothing.

Two structural checks on the bundle itself, which are quick and very hard to eyeball:

```bash
# The server's dependencies actually shipped. Empty or missing ⇒ dead on arrival.
ls release/mac-arm64/Weekloom.app/Contents/Resources/app/node_modules | head

# ⚠️ The asar holds ONLY the compiled main process and the manifest — expect ~5 entries
# and tens of KILObytes. If this prints thousands of entries, `!node_modules/**/*` has
# been dropped from `files:` and the archive has swallowed the whole dependency tree,
# native binaries included, along with an `app.asar.unpacked/` beside it.
npx asar list release/mac-arm64/Weekloom.app/Contents/Resources/app.asar | wc -l
```

Then install it, launch it, and repeat the three runtime checks. A packaged build resolves
`server.js` from a completely different path than a development one does, so it is genuinely a
separate check rather than a formality.

## Troubleshooting

| symptom                                                                                                | cause                                                                                                               | fix                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Blank white window, or the app renders unstyled**                                                    | `.next/static` was not copied                                                                                       | `npm run prepare:standalone`                                                                                                                                                      |
| **"Weekloom could not start" dialog**                                                                  | the server child exited                                                                                             | read the stderr tail in the dialog, then reproduce it directly: `WEEKLOOM_DATA_DIR=$(mktemp -d) PORT=4321 HOSTNAME=127.0.0.1 node .next/standalone/server.js`                     |
| **"The application bundle is incomplete (server.js is missing)"**                                      | `npm run build` was never run, or `extraResources` in `electron-builder.yml` is off by a directory level            | rebuild; for a packaged app, check the paths land at `<resources>/app/server.js`                                                                                                  |
| **Packaged app only: "did not become ready after three attempts", stderr `Cannot find module 'next'`** | `extraResources` copied `.next/standalone` but not its `node_modules` — copying the parent does NOT bring it across | the `- from: .next/standalone/node_modules` / `to: app/node_modules` entry in `electron-builder.yml` is missing; restore it and confirm `Resources/app/node_modules` is non-empty |
| **The DMG is enormous and `app.asar.unpacked/` exists**                                                | `!node_modules/**/*` was dropped from `files:`, so the asar swallowed the dependency tree and its native binaries   | restore the negation; the asar should be ~5 entries and tens of KB                                                                                                                |
| **`crypto.randomUUID is not a function`**                                                              | something changed the window to `file://`, which is not a secure context                                            | put it back on `http://127.0.0.1`; `tests/electron-shell-safety.test.ts` test 3 exists for exactly this                                                                           |
| **`EBADENGINE`, or `Cannot find module 'node:sqlite'`**                                                | Node is below 24                                                                                                    | upgrade Node                                                                                                                                                                      |
| **electron-builder complains about the icon**                                                          | `build/icon.png` is missing or too small                                                                            | it must be a square PNG, at least 512×512; macOS may want 1024×1024                                                                                                               |
| **macOS refuses to open the installed app**                                                            | it is unsigned                                                                                                      | right-click → Open, or `xattr -dr com.apple.quarantine /Applications/Weekloom.app`                                                                                                |

## What NOT to do

- **Do not switch to `output: "export"`.** Server Actions, `cookies()`, `headers()` and dynamic
  routes without `generateStaticParams` are all unsupported under it, and this application is
  built on all of them.
- **Do not load the window from `file://`.** `crypto.randomUUID` and `navigator.clipboard` are
  secure-context-only; `file://` is not one and the board throws on the first task creation.
- **Do not move `.next/standalone` inside the asar archive.** `server.js` calls
  `process.chdir(__dirname)`, and you cannot `chdir` into an asar archive.
- **Do not hardcode a port.** The shell asks the OS for a free one; Next's standalone template
  starts with `allowRetry: false`, so a taken port is a hard failure rather than a fallback.
- **Do not add a native SQLite module** without also adding `@electron/rebuild`, an `asarUnpack`
  entry, and a second build of it against the host Node so `npm test` can still load it. Avoiding
  all three is why the data layer uses `node:sqlite`.
- **Do not commit `release/` or `electron/dist/`.** Both are gitignored build output.
