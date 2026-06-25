# Electron Shell

## Purpose
Hosts the Electron main-process bootstrap, the single `BrowserWindow`, and the IPC contract that the React renderer talks to. It owns app lifecycle (whenReady, before-quit, window-all-closed), preload exposure (`window.api`), the `app://local-file` protocol, version-gate fetch against the Cloudflare Worker, the auto-updater singleton, dialog whitelisting, and the registration of every domain handler (auth, license, system, music, video, video-final-export, autopilot). All renderer↔backend traffic passes through here.

## Entry points
- `electron/main.ts:216` — `app.whenReady()` → registers `app://` protocol, `registerAllHandlers`, `createWindow`, schedules background tasks (cache, security, license, disk, FFmpeg).
- `electron/main.ts:90-91` — `hasActiveExport()` / `setHasActiveExport()` exported for handlers to mirror renderer state into main.
- `electron/handlers/index.ts:15` — `registerAllHandlers(_, getMainWindow)` invoked once at startup; aggregates 6 handler modules.
- `electron/preload.ts:467` — `contextBridge.exposeInMainWorld('api', api)` — sole renderer surface.
- `electron/windowManager.ts:166` — `createWindow()` builds the main `BrowserWindow` with the locked `webPreferences` (sandbox + contextIsolation + nodeIntegration:false).
- `electron/autoUpdaterSingleton.ts:22` — `getAutoUpdater()` returns the lazily-required electron-updater instance, or `null`.
- `electron/authState.ts:94` — `postJson<T>()` is the signed-fetch helper used by every auth handler.

## Core data flow
1. **Boot**: `app.whenReady` → register `app://` → `registerAllHandlers` → `createWindow` → schedule cache cleanup, security/tamper, license refresh, disk scan, FFmpeg probe, 30-min intervals (`main.ts:401-417`).
2. **Version gate**: After `did-finish-load`, main fetches `/api/version-policy` with 12s timeout (`main.ts:99,288`) and emits `version-gate-result` to the renderer; network errors fail-open (`main.ts:208-212`).
3. **Renderer asset load**: Renderer `<audio>/<video>/<img>` URLs go to `app://local-file/?path=...`; protocol handler validates existence, normalizes UNC vs local, and proxies via `net.fetch(file://…)` (`main.ts:223-266`).
4. **Final export**: Renderer `ipcRenderer.send(VIDEO_FINAL_EXPORT_REQUEST)` → handler validates path, rejects if a `video:final-export` job is already pending/running, runs disk-space gate, enqueues into `jobQueue`, streams `…PROGRESS/DONE/ERROR` back, and POSTs tracking to license server on completion (`videoFinalExportHandlers.ts:106-217`).
5. **Updater**: Startup self-IIFE wires events → `updater:status`; autoDownload and autoInstallOnAppQuit are forced false; `app:installUpdate` is rejected when `hasActiveExport()` is true (`main.ts:494-498`, `authHandlers.ts:654-663`).

## Key files
| File | Role |
|------|------|
| `electron/main.ts` | Lifecycle, protocol, version gate, updater wiring, intervals. |
| `electron/windowManager.ts` | BrowserWindow factory, CSP, error page, retry-load, CSP build. |
| `electron/preload.ts` | Sole `window.api` surface; channel allowlist for `on()`. |
| `electron/autoUpdaterSingleton.ts` | `createRequire`-based bypass of Vite transform. |
| `electron/authState.ts` | In-memory auth state, mutex, `postJson`, `isValidAbsolutePath`. |
| `electron/handlers/index.ts` | Aggregator; `registerAllHandlers`. |
| `electron/handlers/authHandlers.ts` | auth/license/app/policy/updater IPC. |
| `electron/handlers/systemHandlers.ts` | dialog/system/jobQueue/ffprobe/folder-scan IPC. |
| `electron/handlers/videoHandlers.ts` | cut/split/merge/mute/normalize IPC + active-job singletons. |
| `electron/handlers/videoFinalExportHandlers.ts` | final-export IPC; cancel registry. |
| `electron/handlers/autopilotHandlers.ts` | autopilot start/cancel/scan IPC; broadcast bridge. |

## IPC channels touched
- invoke: `license:getState/register/retry/clear`; `auth:getState/register/login/refresh/clear/checkStatus/validateKey/validateToken`; `app:getVersion/checkUpdate/downloadUpdate/installUpdate/getUpdateChannel/setUpdateChannel/setExportActive/getGpuFfmpegProfile/setGpuFfmpegProfile/getLegacyGpuFfmpegPath/setLegacyGpuFfmpegPath`; `policy:get`; `security:reportAntiDebug`; `system:info/realtime/getDiskInfo/refreshDiskInfo/createDirectory/openPath/readFileAsBase64`; `dialog:openFile/saveVideoFile/selectFolder/selectVideoFile(s)/selectAudioFile(s)/selectImageFile/selectManyVideos`; `ffmpeg:probe`; `jobQueue:list/get/cancel`; `video:probeFile/getFileInfo/cutSingleSimple/splitManySimple/mergeSimple/muteAudio/normalize/getActiveMute|MergeJobId/getActiveNormalizeJobId/cancelJob/listVideosInFolder*/ultraFastScanFolder/batchLazyProbe/auditFolder/deleteFiles/pool-mark-used/pool-pick-lru/final-export:scan-audio|scan-video|cancel`; `autopilot:getStatus/getRecentLogs/getLogVerbosity/setLogVerbosity/start/cancel/forceReset/scan-video-folders/video-pool-stats/video-pool-clear`.
- send (one-way request): `VIDEO_FINAL_EXPORT_REQUEST`.
- events to renderer: `version-gate-result`, `updater:status`, `app:load-error`, `system:disk-info`, `jobQueue:update`, `video:progress`, `music:exportProgress|enhance:progress|normalizeProgress|normalizeAudio:progress`, `autopilot:status|log`, `youtube:progress|batch-progress|ytdlp-auto-updated|ytdlp-age-warning`, `VIDEO_FINAL_EXPORT_PROGRESS|DONE|ERROR`.

## External dependencies
- Binaries: ffmpeg/ffprobe via `backend/ffmpeg/config` (`main.ts:21,63`); yt-dlp inside `youtube/` subsystem.
- Node libs: `electron`, `electron-updater` (loaded via `createRequire`, `autoUpdaterSingleton.ts:32`), `node:module`, `node:url`, `node:fs`.
- Network: Cloudflare Worker — `${getAuthServerBase()}/api/version-policy` (12s timeout, `main.ts:99`), `${LICENSE_SERVER}/api/video/export` tracking (`videoFinalExportHandlers.ts:72`), and the auth/login/refresh/check-status/validate-key/validate-token endpoints via `postJson` (10s timeout, `authState.ts:33`).
- OS: `shell.openExternal` (https/http only, `windowManager.ts:361`), `shell.openPath/showItemInFolder` (`systemHandlers.ts:163-180`).

## Conventions and invariants
- `webPreferences` are immutable: `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, `webSecurity:!isDev`. `pathToFileURL` is unavailable in the sandbox so preload builds file URLs by hand (`preload.ts:241-252`).
- `window.api.on()` enforces a hardcoded `ALLOWED_CHANNELS` set; unknown channels return a no-op unsubscribe (`preload.ts:434-464`). New event channels MUST be added there.
- `dialog:openFile` filters `properties` to `openFile|multiSelections|openDirectory` — anything else is dropped (`systemHandlers.ts:184`).
- `setWindowOpenHandler` allows `shell.openExternal` only for http/https; everything else is denied (`windowManager.ts:361-373`).
- `protocol.registerSchemesAsPrivileged(['app'])` MUST run before `app.whenReady` (`main.ts:46`).
- Auto-updater: `autoDownload=false`, `autoInstallOnAppQuit=false` are intentional; downloads only on user confirm; install rejected mid-export (`main.ts:497-498`, `authHandlers.ts:656-663`).
- `before-quit` deliberately does NOT call `e.preventDefault()` when an export is active — the comment at `main.ts:467-471` warns this can wedge the app; the only hard gate is `app:installUpdate`.
- DevTools open only when `!app.isPackaged`; the prior `DEBUG=1` backdoor was intentionally removed (`windowManager.ts:354-358`).
- `app:checkUpdate` is debounced at 10s and Promise.race'd against a 30s timeout (`authHandlers.ts:609,626-630`).
- `auth:refresh` keeps an existing `allowed` state on network error rather than degrading to `error` (`authHandlers.ts:339-342`).
- `setAuthState` is serialized through a promise-chain mutex (`authState.ts:162-172`); callers needing completion use `setAuthStateAsync`.
- `isValidAbsolutePath` accepts both `path.isAbsolute` results and UNC paths; UNC validation runs before `path.resolve` because resolve mangles UNC (`authState.ts:56-74`, also relied on at `systemHandlers.ts:425`).
- Per-domain singletons enforce single-active-job: `activeMergeRequestId`, `activeMuteRequestId`, `activeNormalizeRequestId` (`videoHandlers.ts:25-31`); final export uses `jobQueue.getJobs()` lookup instead (`videoFinalExportHandlers.ts:127-130`).
- `final-export:cancel` cancels both the queue handle and `videoJobManager` to actually kill spawned ffmpeg (FIX M14 comment, `videoFinalExportHandlers.ts:181-183`).
- `getMainWindow()` is a getter passed to handlers — never the captured value — so handlers always see the live `windowManager.mainWindow` (`main.ts:38`, `systemHandlers.ts:85`).
- `cleanupStaleScratchDirs` runs on every boot to reclaim space from killed exports (`main.ts:319-323`).

## Risks during refactor
- Moving `protocol.registerSchemesAsPrivileged` after `whenReady` breaks `<audio>/<video>` and image loading silently (`main.ts:46`).
- Touching the `app://` URL parser without preserving the UNC `file:` two-slash branch breaks network-share music/video playback (`main.ts:248-256`).
- Adding a new renderer event channel without listing it in `preload.ts:436` makes the subscription a no-op without a thrown error.
- Rewriting `authState.setAuthState` synchronously reintroduces interleaved-write races (`authState.ts:162`).
- Replacing `createRequire` with native `import('electron-updater')` reverts the bundled-build crash this file was added to fix (`autoUpdaterSingleton.ts:7-13`).
- Calling `e.preventDefault()` in `before-quit` based on `_hasActiveExport` will wedge the process if the export hangs (`main.ts:466-471`).
- Removing the `getMainWindow()` indirection captures a stale window handle after re-create on macOS `activate` (`main.ts:419-423`).
- Dropping the `confirmResourcesForVideoJob` check before video jobs lets jobs start with insufficient disk and fail mid-way (`videoHandlers.ts:182`, `videoFinalExportHandlers.ts:140`).
- Removing the `dialog:openFile` `properties` filter restores a path where the renderer could request privileged dialog modes (`systemHandlers.ts:184-191`).

## Open questions
- `policy:get` (`authHandlers.ts:758`) and `checkVersionGate` (`main.ts:119`) hit the same `/api/version-policy` with different timeouts (10s vs 12s) and slightly different fallbacks — is the duplication intentional or should one delegate to the other?
- `electron/handlers/index.ts:6` imports `./autopilotHandlers`, but `git status` shows `autopilotHandlers.ts` as untracked — is this file meant to be committed, or is autopilot still in flight?
- `setHasActiveExport` is wired into `app:setExportActive`, but nothing in the read scope calls `app.on('before-quit', e.preventDefault())`; is the renderer-side `onbeforeunload` referenced at `main.ts:467` actually implemented elsewhere?
- `auth:validateKey` writes `deviceToken/refreshToken/tokenExpiresAt` into the InternalAuthState object even though the type at `authState.ts:142-153` doesn't declare those fields — intentional dynamic shape, or drift?
