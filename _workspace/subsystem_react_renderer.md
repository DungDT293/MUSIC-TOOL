# React Renderer

## Purpose
Vite + React 18 renderer for the Electron media tool. Owns auth/version gating, the keep-alive tab router, sidebar/top-bar shell, and per-feature pages that drive FFmpeg/YouTube/license work via `window.api.*`. State is local-component-first, with two Zustand stores for cross-tab concerns (active exports, updater status). No business logic runs here — every long task is an IPC roundtrip.

## Entry points
- `src/main.tsx:18-24` — `ReactDOM.createRoot` wraps `<App>` in `<React.StrictMode>` and a top-level `ErrorBoundary`.
- `src/App.tsx:15` — root state machine: version gate → auth gate → `<HashRouter><AppLayout><Router/></AppLayout></HashRouter>`.
- `src/AppLayout.tsx:10` — sidebar + topbar chrome around `<Router/>`.
- `src/router.tsx:48` — keep-alive shell that mounts pages once and toggles `display`.

## Core data flow
1. Boot: main process pushes `version-gate-result` (`App.tsx:72-86`); renderer falls open after 8s if silent (`App.tsx:91-99`). Then auth path: try `auth.validateToken` → `auth.getState` with 5 s timeout (`App.tsx:148-185`). Authenticated branch enters `HashRouter`.
2. Tab switch: `useLocation` change in `router.tsx:62-67` adds path to `mountedPaths`; previously-mounted pages keep their state, hidden via `display:none` (`router.tsx:75-85`). Each page is wrapped in its own `ErrorBoundary` keyed by path.
3. Long IPC events: pages subscribe to namespaced channels (`onVideoProgress`, `youtube.onProgress`, `music.onNormalizeAudioProgress`, `updater.onStatus`, `onDiskInfo`) inside `useEffect`; cleanup calls the returned `unsubscribe` (`App.tsx:122-126`, `TopBarStats.tsx:177-196`).
4. Export-active gate: feature pages call `useExportActivityStore.registerExport/unregisterExport` (`FinalExportTab.tsx:283,635,661`). `App.tsx:130-137` mirrors `activeExports.length > 0` to main via `setExportActive`. Auth/license denial that arrives while an export runs is parked in `pendingDenial`; teardown fires only after `activeExports` drains (`App.tsx:205-233`).
5. Banners: offline license (`App.tsx:479`), update-available (`App.tsx:492-543`), block-message (`App.tsx:442-463`), version-blocking full screen (`App.tsx:385`), disk-space modal mounted by individual export pages (`DiskSpaceErrorModal.tsx`).

## Key files
| Path | Role |
|---|---|
| `src/App.tsx` | Boot, gating, banners, store wiring |
| `src/AppLayout.tsx` | Sidebar + topbar + footer chrome |
| `src/router.tsx` | Keep-alive lazy-mount router |
| `src/components/Sidebar.tsx` | Numbered nav, feature-flag filtered |
| `src/components/TopBarStats.tsx` | CPU/GPU/disk/auth header |
| `src/components/ErrorBoundary.tsx` | Class boundary, dev-only stack |
| `src/components/VersionBlockingScreen.tsx` | Rule A/B blocker UI |
| `src/components/DiskSpaceErrorModal.tsx` | Shared disk-space alert |
| `src/pages/Auth/AuthPage.tsx` | Register/login/key flow |
| `src/pages/License/LicenseGate.tsx` | License activation (legacy path, mounted only via App banners) |
| `src/pages/SettingsPage.tsx` | Update channel, GPU profile, updater controls |
| `src/stores/exportActivityStore.ts` | Cross-feature active-export ledger |
| `src/stores/updaterStore.ts` | Updater state + 10 s check debounce |
| `src/config/featureFlags.ts` | `HIDE_FEATURE_AUTOPILOT` compile-time flag |

## IPC channels touched
- App boot: `app.getVersion`, `auth.validateToken|getState|refresh|register|login|checkStatus|validateKey|clear`, `license.getState|register|retry|clear`, `setExportActive`, `policy.get`.
- Subscribers: `on('version-gate-result')`, `on('app:load-error')`, `updater.onStatus`, `onDiskInfo`, `youtube.onProgress|onBatchProgress`, `onVideoProgress`, `music.onNormalizeAudioProgress`, `onExportProgress`.
- TopBar polls: `getRealtimeStats`, `getDiskInfo`, `getSystemInfo`, `auth.getState`.
- Settings: `updater.check|download|install|getChannel|setChannel`, `app.checkUpdate|getGpuFfmpegProfile|setGpuFfmpegProfile|getLegacyGpuFfmpegPath|setLegacyGpuFfmpegPath`.

## Conventions and invariants
- **Keep-alive is mandatory**: pages assume their state survives tab switches; nothing remounts on navigation (`router.tsx:75-85`). Per-page `ErrorBoundary` is keyed by path so a crash isolates to that tab.
- **Renderer never imports `backend/`**: password strength check uses dynamic `import('../../../shared/passwordValidator')` (`AuthPage.tsx:154,637`). Comment at `AuthPage.tsx:634` calls this out as SEC-02 lint.
- **No AI/LLM in renderer.** No secrets in bundle (`window.api` is the only privileged surface).
- **Polling cadences are fixed and uncoordinated**: realtime stats 1 s (`TopBarStats.tsx:111`), disk-info refresh 30 min (`TopBarStats.tsx:3,186-190`), auth header 30 s (`TopBarStats.tsx:144`), App auth refresh 300 s (`App.tsx:263`), updater check debounce 10 s (`updaterStore.ts:33`).
- **Version gate is fail-open** after 8 s (`App.tsx:91-99`) — main process is the source of truth, renderer never re-checks.
- **Auth denial is delayed** while exports run; `safelyDenyAuth` parks via `setPendingDenial` and a watcher useEffect drains it (`App.tsx:205-233`).
- **`SUSPICIOUS` and `BLOCKED` token results both deny login** (SEC-03, `App.tsx:157-170`).
- **Anti-debug only in PROD** and only inside the cleanup-aware effect (`App.tsx:33-53`).
- `#export` hash short-circuits the entire UI (`App.tsx:302-304`) — but `ExportRunner` is no longer imported (post song-nhac removal).
- Sidebar numbering is recomputed after filtering hidden items (`Sidebar.tsx:35-38`) so `/settings` shows as #9 when autopilot is hidden.

## Risks during refactor
- `AppLayout.tsx:31-32` reads `isVisualizerPage` which is **not defined or imported**; renderer compiles only because TS has it loose, behaviour is whatever JS coerces. Dead conditional branches for `overflow`, `padding`, and topbar visibility.
- `App.tsx:303` returns `<ExportRunner />` with **no import** — dangling reference from the deleted song-nhac feature; `#export` route is broken.
- `App.tsx:236-274` and `TopBarStats.tsx:125-155` both poll auth independently. Diverging state if one races the other.
- `router.tsx:53-67` lazy mount stores state in `mountedPaths` Set + `useState` — a route flag flip (e.g., toggling `HIDE_FEATURE_AUTOPILOT`) at runtime would not unmount stale pages because the constant is module-scope.
- `App.tsx:56-105` `setVersionGateResult` setter inside `setTimeout` references prev state via functional form, but the `unsubscribe?.()` only fires on unmount — if main resends after fallback fired, the result will overwrite `'allow'` mid-session.
- `exportActivityStore` only currently registers from `FinalExportTab`; other export pages (`ExportAudioPage`, `MergeTab`, `MultiCutTab`, etc.) **do not register**, so `setExportActive` underreports and `safelyDenyAuth` may tear down mid-export.
- `Sidebar.tsx:46-48` calls `getVersion` once with no abort signal; harmless but pattern is repeated across components without a shared hook.

## Open questions
- Is the `#export` offscreen-window path still wired in main, given `ExportRunner` is gone? Should `App.tsx:302-304` be removed?
- Should non-FinalExport export flows participate in `exportActivityStore` to honour the auth-teardown delay?
- Why two auth poll loops (30 s and 5 min)? Can they be consolidated under one IPC subscriber?
- `isVisualizerPage` — leftover from song-nhac visualizer; safe to delete or is there a planned replacement?
- `LicenseGate.tsx` is imported nowhere in this scope; is it still reachable, or dead since auth-V2?
