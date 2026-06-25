# 93 Media Tool — Project Map

Pre-refactor reference. Reads as a map of the territory, not a refactor plan. Citations use `path:line`. Subsystem detail lives in the linked `subsystem_*.md` files.

## Top-level architecture

The product is a Vite + React 18 renderer hosted by an Electron main process, glued by a `contextBridge`-exposed `window.api` surface in [electron/preload.ts](electron/preload.ts). The renderer never imports `backend/` and holds no secrets — every long-running task is an IPC roundtrip. Main process owns: lifecycle ([electron/main.ts:216](electron/main.ts)), the lone `BrowserWindow` ([electron/windowManager.ts:166](electron/windowManager.ts)), `app://local-file` protocol, the auto-updater singleton ([electron/autoUpdaterSingleton.ts:22](electron/autoUpdaterSingleton.ts)), and registration of six handler modules via [electron/handlers/index.ts:15](electron/handlers/index.ts). Backend services live under `backend/` by domain (music, video, autopilot, youtube, license, security, system, ffmpeg) and are invoked exclusively from main-process handlers — they never see the renderer directly.

External coupling: FFmpeg/ffprobe binaries resolved at `<resourcesPath>/bin` ([backend/ffmpeg/config.ts:24](backend/ffmpeg/config.ts)); yt-dlp binary at the same location. License/auth talks to a Cloudflare Worker ([server/](server/)) backed by D1 (`license-db`, see `server/wrangler.toml:20`), with HMAC-SHA256 request signing keyed by a PBKDF2(machineId) derivation. The renderer talks to the Worker only via main-process IPC (`policy:get`, `auth:*`, `license:*`); the only outbound request types from main are auth/policy fetches, video-export tracking, security reports, and updater downloads from GitHub releases. There is **no AI/LLM at runtime**; agents and skills are a dev harness. Coupling between renderer ↔ preload ↔ ipc.ts ↔ handlers ↔ `shared/*Channels.ts` is hand-maintained — not generated — and is the most common drift surface.

## Subsystems

### Electron Shell — see [subsystem_electron_shell.md](subsystem_electron_shell.md)

Hosts main-process bootstrap, single `BrowserWindow`, the `window.api` contract, version-gate, dialog whitelist, and registration of every domain handler. Entry: [electron/main.ts:216](electron/main.ts) (`whenReady`), [electron/handlers/index.ts:15](electron/handlers/index.ts) (`registerAllHandlers`), [electron/preload.ts:467](electron/preload.ts) (`exposeInMainWorld`), [electron/windowManager.ts:166](electron/windowManager.ts) (`createWindow`), [electron/authState.ts:94](electron/authState.ts) (`postJson`).

Invariants:
- `webPreferences` are immutable: `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`. New event channels MUST be listed in `preload.ts`'s `ALLOWED_CHANNELS` allowlist or `on()` is a silent no-op ([electron/preload.ts:436](electron/preload.ts)).
- `protocol.registerSchemesAsPrivileged(['app'])` MUST run before `app.whenReady` ([electron/main.ts:46](electron/main.ts)) or all media playback breaks.
- Auto-updater is `autoDownload=false`, `autoInstallOnAppQuit=false`; install is rejected when `hasActiveExport()` ([electron/handlers/authHandlers.ts:656](electron/handlers/authHandlers.ts)).

### Media — Music — see [subsystem_media_music.md](subsystem_media_music.md)

Scans local audio libraries, builds duration-targeted playlists with priority/random/pinned tiers and a 3-tier LRU pool, renders concat or crossfade outputs, plus standalone normalize/enhance/Whisper utilities. Entry: [backend/music/scanMusic.ts:254](backend/music/scanMusic.ts), [backend/music/playlistEngine.ts:281](backend/music/playlistEngine.ts), [backend/music/exportAudio.ts:221](backend/music/exportAudio.ts), [backend/music/normalizeAudio.ts:395](backend/music/normalizeAudio.ts), [backend/music/enhanceAudio/index.ts:69](backend/music/enhanceAudio/index.ts).

Invariants:
- **Audio export duration semantics are intentional** — crossfade target inflation, auto-extend by appending shuffled scan tracks, and final probe report ([backend/music/exportAudio.ts:299](backend/music/exportAudio.ts), [:522](backend/music/exportAudio.ts), [:846](backend/music/exportAudio.ts)). Do not change.
- `normalizeAudio` overwrite guard refuses output when path resolves to input or collides on extension change ([backend/music/normalizeAudio.ts:273](backend/music/normalizeAudio.ts)).
- AAC stream-copy fast path skips re-encode iff format=='aac' and every input is `.m4a/.aac` ([backend/music/exportAudio.ts:391](backend/music/exportAudio.ts)) — 20–50× speedup.

### Media — Video — see [subsystem_media_video.md](subsystem_media_video.md)

Final Export pipeline: scan audio + video sources, build duration-targeted concat playlist, optionally normalize/transcode, mux audio onto concatenated video, optional chroma-key overlay, verify output. Entry: [backend/video/finalExport.ts:3197](backend/video/finalExport.ts) (`exportFinalVideo`), [:3180](backend/video/finalExport.ts) (`scanFinalExportVideo`), [backend/video/normalizeVideo.ts:74](backend/video/normalizeVideo.ts), [backend/video/finalExport.ts:128](backend/video/finalExport.ts) (`generateChromaKeyPreview`), [backend/video/videoJobManager.ts:144](backend/video/videoJobManager.ts).

Invariants:
- Cancellation contract: every spawn registers in `videoJobManager`; identity check `proc === jobs.get(id)` survives GPU→CPU re-registration ([backend/video/videoJobManager.ts:31](backend/video/videoJobManager.ts)).
- `chromaKeyActive` is intentionally part of `needVideoReencode` ([backend/video/finalExport.ts:2367](backend/video/finalExport.ts)) so the single-step chroma path respects the user's GPU/CPU encoder choice.
- Pre-transcode cache is shared across all jobs in one export ([backend/video/finalExport.ts:806](backend/video/finalExport.ts)); per-job maps would multiply cost. Output verification is mandatory: missing streams, >5s duration drift, or decode failure throws ([:1123](backend/video/finalExport.ts)).

### Autopilot — see [subsystem_autopilot.md](subsystem_autopilot.md)

Multi-day batch orchestrator: scan music, build N playlists per day, export to AAC, pick videos with LRU pool + sequence fingerprint dedup, drive `finalExport`. Singleton in main process. Entry: [electron/handlers/autopilotHandlers.ts:38](electron/handlers/autopilotHandlers.ts), [backend/autopilot/autopilotRunner.ts:616](backend/autopilot/autopilotRunner.ts) (`startAutopilot`), [:551](backend/autopilot/autopilotRunner.ts) (`forceResetAutopilot`), [:994](backend/autopilot/autopilotRunner.ts) (`validateAutopilotStartConfig`), [backend/autopilot/videoPool.ts](backend/autopilot/videoPool.ts).

Invariants:
- Stale-lock recovery is **token-agnostic**: triggers on `lastHeartbeatAt > 0 && staleDuration > STALE_LOCK_TIMEOUT_MS` (5 min) and nulls `activeRunToken` itself ([backend/autopilot/autopilotRunner.ts:625](backend/autopilot/autopilotRunner.ts)). Reintroducing a `!activeRunToken` guard reopens the permanent-lock bug.
- Step ordering is fixed: `pickUniqueSequence` returns LRU-shuffled paths → reassign `selectedVideoPaths` (do not mutate) → `markClipsUsed` only **after** export succeeds ([:2468](backend/autopilot/autopilotRunner.ts), [:2651](backend/autopilot/autopilotRunner.ts)).
- `cancelAutopilot` only kills jobs whose `requestId.startsWith('autopilot-')` ([:155](backend/autopilot/autopilotRunner.ts)) — sibling video jobs are untouched.

### YouTube Downloader — see [subsystem_youtube.md](subsystem_youtube.md)

Multi-platform fetcher built on bundled `yt-dlp.exe` plus a custom Facebook scraper. Singleton `YouTubeDownloader` (EventEmitter) wrapped by IPC handlers. Entry: [electron/youtube/youtubeHandlers.ts:43](electron/youtube/youtubeHandlers.ts) (`setupYouTubeHandlers`), [:565](electron/youtube/youtubeHandlers.ts) (`cleanupYouTubeHandlers`), [backend/youtube/youtubeDownloader.ts:35](backend/youtube/youtubeDownloader.ts), [src/pages/Video/YouTubeDownloaderTab.tsx:37](src/pages/Video/YouTubeDownloaderTab.tsx).

Invariants:
- yt-dlp args are passed as a JS array, spawned without a shell — never string-concat URLs/paths ([backend/youtube/youtubeDownloader.ts:1188](backend/youtube/youtubeDownloader.ts)).
- YouTube `player_client=tv,android_vr,web_safari` (or `tv,web_safari` with cookies) is load-bearing for 4K DASH without PO token ([:779](backend/youtube/youtubeDownloader.ts), [:1219](backend/youtube/youtubeDownloader.ts)). Reverting to plain `web` or `android` silently degrades quality.
- Cancel path: `youtube:cancel-download` prefers `jobQueue.cancelJob(currentYoutubeJobId)`, falls back to `cancelDownload()` which SIGTERMs every entry in `activeProcesses` Map. Several spawn sites (`downloadVideoWithArgsOnce`, `downloadVideoToFolder`, info/version) use the legacy `currentProcess` setter and are NOT killed by cancel ([:1441](backend/youtube/youtubeDownloader.ts), [:2306](backend/youtube/youtubeDownloader.ts)).

### License / Auth / Server — see [subsystem_license_auth.md](subsystem_license_auth.md)

Machine-bound license + account auth. Electron derives stable hardware hash, signs every request with HMAC-SHA256, round-trips a Cloudflare Worker (D1-backed) for register/validate/JWT-token flows. Renderer holds no secrets. Entry: [electron/handlers/authHandlers.ts:59](electron/handlers/authHandlers.ts), [electron/authState.ts:190](electron/authState.ts) (`getOrInitAuthState`), [backend/license/onlineLicenseService.ts:105](backend/license/onlineLicenseService.ts), [server/index.ts:27](server/index.ts) (Worker router), [server/auth-v2-handlers.ts](server/auth-v2-handlers.ts).

Invariants:
- `DEFAULT_POLICY_VERSION = '4.4.0'` ([server/env.ts:26](server/env.ts)) must equal current `package.json` version on every release; `policy:get` falls open to it on Worker error.
- HMAC signing key = PBKDF2(machineId, salt='93MediaToolMixNhac2025APISigningSalt!', 10000, SHA-256) — same on both sides; no shared secret needed. Length-mismatch logs and rejects before `timingSafeEqual` ([backend/security/apiSigning.ts:163](backend/security/apiSigning.ts)).
- Five LicenseStatus states (`checking | needsRegistration | pending | ok | offline | denied`) and a separate InternalAuthStatus enum (`unregistered | pending | allowed | blocked | error`) at [electron/authState.ts:140](electron/authState.ts). `setAuthState` is mutex-serialized ([:155](electron/authState.ts)); use `setAuthStateAsync` in new code.

### React Renderer — see [subsystem_react_renderer.md](subsystem_react_renderer.md)

Vite + React 18. Owns auth/version gating, keep-alive tab router, sidebar/topbar shell, per-feature pages. State is local-component-first with two Zustand stores (`exportActivityStore`, `updaterStore`). Entry: [src/main.tsx:18](src/main.tsx), [src/App.tsx:15](src/App.tsx), [src/AppLayout.tsx:10](src/AppLayout.tsx), [src/router.tsx:48](src/router.tsx).

Invariants:
- Keep-alive routing: pages mount once and toggle `display:none` ([src/router.tsx:75](src/router.tsx)). Per-page `ErrorBoundary` keyed by path. Pages may assume their state survives tab switches.
- Renderer never imports `backend/`. Password strength check uses dynamic import of `shared/passwordValidator` ([src/pages/Auth/AuthPage.tsx:154](src/pages/Auth/AuthPage.tsx)) per SEC-02.
- Auth denial is delayed while exports run via `pendingDenial` ([src/App.tsx:205](src/App.tsx)); teardown fires only after `activeExports` drains.

## Cross-cutting concerns

**IPC contract surface.** Four-layer triad: [electron/preload.ts](electron/preload.ts) (allowlisted `window.api` + `ALLOWED_CHANNELS`) ↔ [src/types/ipc.ts](src/types/ipc.ts) (renderer types) ↔ `electron/handlers/*` (`ipcMain.handle`/`on`) ↔ `shared/*Channels.ts` (constants). Hand-maintained — drift between layers compiles silently when call sites use optional chaining (`api?.method?.(...)`). Most recent drift caught by integration-qa: `chromaKeyPreview` exposed in preload + handler but missing from `ipc.ts`.

**Cancellation contract.** Two patterns coexist:
- `videoJobManager` registry with identity check ([backend/video/videoJobManager.ts:31](backend/video/videoJobManager.ts)) — used by every `finalExport` spawn.
- `jobQueue.cancelJob(id)` with `onCancel` thunk — used by youtube and final-export-handler. Single-active-job singletons in [electron/handlers/videoHandlers.ts:25](electron/handlers/videoHandlers.ts) (merge/mute/normalize) plus per-job `cancelContext` in `normalizeAudio`.

Known gaps: youtube's Facebook scraper, retry-backoff sleep, and `downloadVideoWithArgsOnce`/`downloadVideoToFolder` paths are NOT cancellable; `enhanceAudio` cancel state is module-level and unsafe under concurrent calls.

**Active-export guard.** [electron/main.ts:90](electron/main.ts) (`hasActiveExport`/`setHasActiveExport`) mirrors renderer state; renderer drives via `useExportActivityStore` ([src/App.tsx:130](src/App.tsx)). Updater install is hard-gated on it ([electron/handlers/authHandlers.ts:656](electron/handlers/authHandlers.ts)). Auth-denial teardown is delayed until exports drain. **Gap**: only `FinalExportTab` registers — `ExportAudioPage`, `MergeTab`, `MultiCutTab` do not, so `setExportActive` underreports.

**Secrets boundary.** Worker secrets (`INSTALLER_SECRET`, `ADMIN_TOKEN`, `JWT_SECRET`, `OWNER_PASSWORD_HASH`, `SENDGRID_API_KEY`) live only in Worker env. Electron secrets (`LICENSE_INSTALLER_KEY`, `LICENSE_INSTALLER_SECRET`) live only in main process; renderer reads only `LICENSE_SERVER_BASE`/`AUTH_BASE` build-time vars. Missing `LICENSE_INSTALLER_KEY` becomes sentinel `__MISSING_INSTALLER_KEY__` ([backend/license/onlineLicenseService.ts:29](backend/license/onlineLicenseService.ts)) so server rejects rather than empty-string-passing. `stringEncryption.ts` is **obfuscation only**, not a secret store.

**Windows path safety.** `\\?\` long-path prefix on local drives >240 chars ([backend/ffmpeg/wrapper.ts:48](backend/ffmpeg/wrapper.ts)). Concat-list path escaping is Windows-aware (forward slashes + quoted, [backend/video/finalExport.ts:186](backend/video/finalExport.ts)). UNC validation runs **before** `path.resolve` because resolve mangles UNC ([electron/authState.ts:56](electron/authState.ts)). `app://` URL parser preserves the UNC `file:` two-slash branch ([electron/main.ts:248](electron/main.ts)). `windowsHide:true` required on every spawn.

**GPU/CPU encoder choice plumbing.** [backend/utils/gpuDetection.ts](backend/utils/gpuDetection.ts) (`buildVideoEncoderArgsWithChoice`, `getGpuInfo`) is the single source of truth. Dual-profile FFmpeg via [backend/ffmpeg/gpuProfile.ts:88](backend/ffmpeg/gpuProfile.ts) (`ffmpeg-modern`/`ffmpeg-legacy`) reads `appSettings`. `normalizeVideo` only has a NVENC fast path ([backend/video/normalizeVideo.ts:317](backend/video/normalizeVideo.ts)); AMD/Intel fall back to CPU silently. The single-step chroma path explicitly strips `-hwaccel` and rewrites `-vsync 2` to `cfr` because concat demuxer rejects hw-decode ([backend/video/finalExport.ts:2401](backend/video/finalExport.ts)).

## Refactor risk register

Aggregated across all 7 maps, grouped by severity.

### Could silently break

- **Concat demuxer hw-decode**: removing `-hwaccel` strip / `-vsync` rewrite ([backend/video/finalExport.ts:2401](backend/video/finalExport.ts)).
- **Chroma encoder choice**: moving `chromaKeyActive` out of `needVideoReencode` reverts the just-fixed bug ([:2367](backend/video/finalExport.ts)).
- **Pre-transcode cache**: replacing shared cache with per-job maps multiplies cost by `totalJobs` ([:806](backend/video/finalExport.ts)); broadening eviction corrupts shared cache for other jobs ([:2535](backend/video/finalExport.ts)).
- **Cancellation identity check**: dropping `proc === jobs.get(id)` causes GPU→CPU fallback to delete the new process ([backend/video/videoJobManager.ts:31](backend/video/videoJobManager.ts)).
- **Autopilot stale-lock**: reintroducing `!activeRunToken` guard ([backend/autopilot/autopilotRunner.ts:625](backend/autopilot/autopilotRunner.ts)).
- **LRU shuffle order**: mutating `selectedVideoPaths` in place at [:2468](backend/autopilot/autopilotRunner.ts) silently restores alphabetical order.
- **Renderer event channels**: adding without `ALLOWED_CHANNELS` listing makes subscription a silent no-op ([electron/preload.ts:436](electron/preload.ts)).
- **Schemes registration**: moving `registerSchemesAsPrivileged` after `whenReady` breaks all media playback ([electron/main.ts:46](electron/main.ts)).
- **`createRequire` updater**: replacing with native `import('electron-updater')` reverts the bundled-build crash fix ([electron/autoUpdaterSingleton.ts:7](electron/autoUpdaterSingleton.ts)).
- **`auth:refresh` network failure**: degrading to `error` instead of keeping `allowed` triggers spurious tear-downs ([electron/handlers/authHandlers.ts:339](electron/handlers/authHandlers.ts)).
- **`DEFAULT_POLICY_VERSION` bumps**: without DB upsert, silently downgrades clients on policy fetch error ([server/env.ts:26](server/env.ts)).
- **Audio export duration semantics**: any change to crossfade target inflation or auto-extend ([backend/music/exportAudio.ts:299](backend/music/exportAudio.ts), [:522](backend/music/exportAudio.ts)).
- **Normalize overwrite guard**: weakening collision check enables silent overwrites ([backend/music/normalizeAudio.ts:273](backend/music/normalizeAudio.ts)).
- **Renderer: `exportActivityStore` underreporting**: non-FinalExport export flows don't register, so auth-denial teardown can fire mid-export.
- **Output verification**: loosening any of the four checks (missing streams, duration drift, decode failure) ships broken outputs ([backend/video/outputVerification.ts:125](backend/video/outputVerification.ts)).

### Would be noticed

- `before-quit` adding `e.preventDefault()` based on `_hasActiveExport` wedges the process ([electron/main.ts:466](electron/main.ts)).
- `setAuthState` synchronous rewrite reintroduces interleaved-write races ([electron/authState.ts:155](electron/authState.ts)).
- Removing `getMainWindow()` indirection captures stale window after macOS `activate` re-create ([electron/main.ts:419](electron/main.ts)).
- Dropping `confirmResourcesForVideoJob` lets jobs start with insufficient disk ([electron/handlers/videoFinalExportHandlers.ts:140](electron/handlers/videoFinalExportHandlers.ts)).
- `enhanceAudio` module-level cancel ([backend/music/enhanceAudio/ffmpegRunner.ts:13](backend/music/enhanceAudio/ffmpegRunner.ts)) is unsafe under concurrent calls.
- `pickVideosFromFolders` ignores `playlist.length` when computing `targetCount`; small folders fail late ([backend/autopilot/autopilotRunner.ts:2433](backend/autopilot/autopilotRunner.ts)).
- yt-dlp `addProcess` keys on `dl-${Date.now()}`; same-ms downloads collide ([backend/youtube/youtubeDownloader.ts:1258](backend/youtube/youtubeDownloader.ts)).
- `cancelDownload` clears entire `activeProcesses` Map; concurrent batch cancels all peers ([:1056](backend/youtube/youtubeDownloader.ts)).
- `auto-rebind` (`autoRebindMachineId`) defined but only fired through the UUID-aware key matcher; ambiguous semantics on cross-machine activation.
- `authHandlers.refreshLicenseState` overwrites `machineHash` with old value on failure; identity continuity matters for retry UX.

### Cosmetic / latent

- `pathUtils.ts` is empty (0 bytes) — any importer relies on no exports.
- `playlistEngine.ts:453` lazy-requires `electron`; tests fall back to `cwd()`.
- `getStorageDir` and `getLogDir` fall back to `process.cwd()` outside Electron ([backend/autopilot/videoPool.ts:71](backend/autopilot/videoPool.ts), [backend/autopilot/autopilotRunner.ts:178](backend/autopilot/autopilotRunner.ts)).
- `AppLayout.tsx:31` references undefined `isVisualizerPage`; dead conditional from removed song-nhac.
- `App.tsx:303` returns `<ExportRunner />` with no import — dangling reference; `#export` route is broken.
- Two auth poll loops (30 s + 5 min) diverge state ([src/App.tsx:236](src/App.tsx), [src/components/TopBarStats.tsx:125](src/components/TopBarStats.tsx)).
- `auth-v2-handlers.ts:488,701,916,1112` — disabled `if (false && ...)` tamper-block dead branches.
- `startAutopilotLegacy` ([backend/autopilot/autopilotRunner.ts:2662](backend/autopilot/autopilotRunner.ts)) — 498-line dead duplicate.
- `downloadVideoWithArgsOnce` ([backend/youtube/youtubeDownloader.ts:1323](backend/youtube/youtubeDownloader.ts)) — appears unreferenced.
- `LicenseGate.tsx` imported nowhere in renderer scope.
- `policy:get` ([electron/handlers/authHandlers.ts:758](electron/handlers/authHandlers.ts)) duplicates `checkVersionGate` ([electron/main.ts:119](electron/main.ts)) at different timeouts.

## Open questions to resolve before refactor

1. Should `startAutopilotLegacy` (498-line duplicate, [backend/autopilot/autopilotRunner.ts:2662](backend/autopilot/autopilotRunner.ts)) be deleted outright?
2. Is the 5-min `STALE_LOCK_TIMEOUT_MS` still right given audio export timeout is 30 min — does a stuck export with FFmpeg progress emits look healthy because heartbeat refreshes?
3. `videoPool` shuffle-until-unique can settle on a known-colliding fingerprint after `maxAttempts` ([backend/autopilot/videoPool.ts:395](backend/autopilot/videoPool.ts)) — is "≈0 probability" still acceptable for small pools?
4. Should `pickVideosFromFolders` floor lift to `Math.max(minTotal, playlists.length)` so step-3 doesn't fail mid-day?
5. `autopilot:scan-video-folders` re-implements a directory walk distinct from `collectVideoFilesRecursive` — intentional or unification candidate?
6. Should `enhanceAudio` adopt the per-job cancel pattern from `normalizeAudio` to support concurrent batches?
7. Is the `Math.random()` shuffle + 30-attempt retry in `playlistEngine` acceptable, or should a seedable RNG enable reproducible exports?
8. Why does `crossfadeDurationSec` parsing live duplicated at [backend/music/exportAudio.ts:335](backend/music/exportAudio.ts) and [:1030](backend/music/exportAudio.ts)?
9. Is `effectiveTargetSec` average of 210 s a calibrated number or a placeholder, and how does it behave with libraries far from that mean?
10. `pathUtils.ts` is empty — was its API moved or is something importing a missing symbol?
11. Should `loadPersistedPlaylists` validate paths lazily on first track use rather than skipping entirely?
12. `shared/canvasExportTypes.ts` is wired into `FinalExportRequestPayload.canvasScene` but no backend reads it — deferred or dead?
13. Is `runPlaybackTest`-only-on-`forceReencode` intentional given two-pass also re-encodes?
14. Does autopilot tolerate a manifest-less `normalizeVideo` success when every clip was `skipExisting`?
15. Subtitle plumbing in `FinalExportRequestPayload.subtitle` is rich but `executeFinalExport` passes `undefined` ([backend/video/finalExport.ts:3254](backend/video/finalExport.ts)) — currently no-op?
16. Should the disabled `if (false && ...)` tamper-block paths in `auth-v2-handlers.ts` be removed, or is re-enable planned?
17. Is `auto-rebind` intended to fire automatically on key match across machines, or remain admin-gated?
18. Should `auth:refresh` have a max consecutive-failure window before forcing re-validation?
19. Should `policy:get` cache the last successful policy fetch instead of falling open to local app version?
20. V1 `/api/auth/check` and V2 `/api/auth/login` accept the same payload — V1 deprecated or still receiving traffic?
21. Should the per-yt-dlp-job process map key on `ctx.jobId` instead of `dl-<ts>`?
22. Are `downloadVideoWithArgsOnce` and the `currentProcess` setter still needed?
23. Should temp Netscape cookie files be deleted after each yt-dlp invocation or restricted-ACL?
24. Should `FacebookScraper` expose its in-flight `https.request` so cancel can `req.destroy()` it?
25. Is `rejectUnauthorized:false` required by any current network path or leftover debugging?
26. Is `electron/handlers/autopilotHandlers.ts` (untracked in git) meant to be committed?
27. Why two auth poll loops (30 s + 5 min) — can they be consolidated?
28. Is `#export` offscreen-window path still wired in main now that `ExportRunner` is gone?
29. Should non-FinalExport export flows participate in `exportActivityStore` to honour auth-teardown delay?
30. `isVisualizerPage` in `AppLayout.tsx:31` — leftover from song-nhac, safe to delete?
31. Is `LicenseGate.tsx` still reachable since auth-V2?
32. Does `auth:validateKey` writing `deviceToken/refreshToken/tokenExpiresAt` into `InternalAuthState` (not in declared type) reflect intentional dynamic shape or drift?

## Outstanding HIGH findings (deferred)

Carried forward from [orchestrator_report.md](orchestrator_report.md). Some originally listed have since been fixed (B1 `DEFAULT_POLICY_VERSION` bumped to 4.4.0, H1 chroma encoder choice, H3 normalize overwrite guard, H4 `chromaKeyPreview` IPC type, H5 autopilot stale-lock recovery). The following are still open or carry residual work:

1. **B3 — `chromaKeyOverlay.offsetY` shared-type plumbing**: code reads `offsetY` but [shared/videoFinalExportChannels.ts](shared/videoFinalExportChannels.ts) only has `position: 'center' | 'bottom'`. Decide: add field + plumb from UI, or drop offsetY logic.
2. **H2 — `preTranscodeClips` over-encodes**: parallel workers grab indices past duration target before early-exit fires, transcoding extra clips and leaving orphan `pre_*.mp4`. Fix: walk slots, break at threshold, cleanup unused outputs.
3. **H6 — Autopilot collision check uses non-deterministic projected paths**: `buildProjectedAutopilotOutputPaths` calls `generateSimpleTitles` → `shuffleArrayInPlace`; names checked at validation differ from runtime. Restrict to deterministic title sources or move check to runtime.
4. **H7 — Dead `startAutopilotLegacy`**: 498-line unreferenced duplicate ([backend/autopilot/autopilotRunner.ts:2658](backend/autopilot/autopilotRunner.ts)). Delete.
5. **H8 — TLS validation off while transmitting auth cookies**: `rejectUnauthorized:false` on `https.request` in [backend/youtube/cookieManager.ts:463](backend/youtube/cookieManager.ts). MITM risk on session cookies.
6. **H9 — Facebook downloads ignore cancel**: `FacebookScraper.downloadVideo` not in `activeProcesses`. Thread an `AbortSignal` and break batch loop on cancel.
7. **H10 — yt-dlp retry sleep ignores cancel**: `await sleep(waitMs)` between attempts not racing `ctx.signal` ([electron/youtube/youtubeHandlers.ts:239](electron/youtube/youtubeHandlers.ts)). Race against abort.
8. **H11 — Cookie file persists in predictable temp path**: Netscape file at `%TEMP%/media-tool-cookies/{platform}-cookies.txt` plaintext, never unlinked ([backend/youtube/youtubeDownloader.ts:125](backend/youtube/youtubeDownloader.ts)). Delete in close handler or move to userData with restricted ACL.
9. **H12 — Domain cutover risk in env example + wrangler**: `LICENSE_SERVER_BASE`/`AUTH_BASE` documented for `admin93media.xyz` but `workers_dev=true` with commented routes in [server/wrangler.toml:8](server/wrangler.toml). Add fallback comment; attach Dashboard route before flipping installer envs; verify `curl https://admin93media.xyz/api/version-policy` returns 200 before release.
