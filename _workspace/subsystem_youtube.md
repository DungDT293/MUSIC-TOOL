# YouTube Downloader

## Purpose
Multi-platform media fetcher built on a bundled `yt-dlp.exe` plus a custom Facebook scraper. Renderer (`YouTubeDownloaderTab.tsx`) drives a tab-level UI for single videos, channels/playlists, batch queues, and cookie management; main-process handlers wrap a singleton `YouTubeDownloader` (EventEmitter) that spawns yt-dlp child processes, parses progress, manages cookies via `CookieManager`, and bypasses yt-dlp entirely for Facebook by direct CDN scraping. Supports YouTube, SoundCloud, TikTok, Facebook (and ad-hoc Chinese / Vietnamese hosts via per-hostname arg packs).

## Entry points
- `electron/youtube/youtubeHandlers.ts:43` — `setupYouTubeHandlers(mainWindow)` called from main on app-ready; idempotent via `youtubeHandlersRegistered` flag (FIX M20, line 15/48).
- `electron/youtube/youtubeHandlers.ts:565` — `cleanupYouTubeHandlers()` removes all 15 channels by name.
- `backend/youtube/youtubeDownloader.ts:35` — `class YouTubeDownloader extends EventEmitter`, constructed once per `setupYouTubeHandlers`.
- `src/pages/Video/YouTubeDownloaderTab.tsx:37` — React tab component; uses `window.api.youtube.*` IPC surface.

## Core data flow
1. Renderer calls `youtube:validate-url` → `youtube:get-video-info` / `youtube:get-channel-info`/`get-channel-videos` → user picks output dir/quality → `youtube:download-video` or `youtube:download-channel`. Both download handlers wrap the work in `jobQueue.enqueue` so cancel routes through `jobQueue.cancelJob` → `onCancel: cancelDownload()` (`youtubeHandlers.ts:225,321,386`).
2. yt-dlp invocation: `downloadVideo` builds `cmd[]` array (path + flags + URL) and `spawn(cmd[0], cmd.slice(1))` with no shell — args passed as separate elements, so Windows paths with spaces survive without quoting (`youtubeDownloader.ts:1188-1257`). Process is registered in `activeProcesses` Map keyed by a generated `dl-<ts>` id (`:1259, :1075`).
3. Progress: stdout/stderr lines are regex-parsed in `parseDownloadProgress` (`:1088`) and emitted as `progress` events; main forwards to renderer via `webContents.send('youtube:progress', …)` (`youtubeHandlers.ts:57`). Per-job progress listener inside `task` translates events into `ctx.updateProgress(percent, message)` for jobQueue (`:231-236, :330-340`).
4. Channel batch: `downloadChannel` enumerates with `--flat-playlist --dump-json`, optionally filters by `minDurationSeconds`, creates `<channel>/videos|audios|thumbnails/` tree, then iterates sequentially calling `downloadVideoToFolder` (yt-dlp) or `downloadFacebookVideo` (scraper) and emits `batch-progress` (`:2031-2225`). Concurrent variant uses `Promise.allSettled` chunks of size `concurrency` (`:2401`).
5. Facebook fast-path: `isFacebookUrl` short-circuits `getVideoInfo`, `getChannelVideos`, and `downloadVideo` to `FacebookScraper`, which fetches HTML via `https.request` with `rejectUnauthorized:false`, parses `data-sjs` script JSON / Tahoe POST / DASH manifest for HD URLs, then streams the CDN mp4 directly to disk (`facebookScraper.ts:683, :772`).

## Key files
| File | Role |
|---|---|
| `backend/youtube/youtubeDownloader.ts` | Core class; yt-dlp orchestration, format selectors, progress parsing, retry strategies, channel batch logic. |
| `backend/youtube/cookieManager.ts` | Imports J2Team JSON cookies, writes Netscape file for `--cookies`, tests via HTTPS `GET`. |
| `backend/youtube/facebookScraper.ts` | Fully replaces yt-dlp for Facebook reels/videos; HTML scrape + CDN download. |
| `backend/youtube/browserCookieService.ts` | Extracts cookies from installed browsers into a temp file. |
| `backend/youtube/tracklistDetector.ts` | Parses video description into a sidecar `_tracklist.txt`. |
| `backend/youtube/SafeFolderManager.ts` | Path sanitization helper (declared field, not actively used in current paths). |
| `electron/youtube/youtubeHandlers.ts` | 15 IPC handlers, jobQueue integration, 5s post-startup auto-update. |
| `src/pages/Video/YouTubeDownloaderTab.tsx` | UI: URL input, info preview, settings, queue, cookie manager. |

## IPC channels touched
- `youtube:verify`, `youtube:validate-url`, `youtube:get-video-info`, `youtube:get-channel-info`, `youtube:get-channel-videos`, `youtube:estimate-channel-size`
- `youtube:download-video`, `youtube:download-channel`, `youtube:cancel-download`, `youtube:update-ytdlp`
- `youtube:cookie-import`, `youtube:cookie-list`, `youtube:cookie-test`, `youtube:cookie-remove`, `youtube:cookie-has`
- Outbound (main→renderer): `youtube:progress`, `youtube:batch-progress`, `youtube:ytdlp-auto-updated`, `youtube:ytdlp-age-warning`

## External dependencies
- Binary: `yt-dlp.exe` (Win) / `yt-dlp` (Unix) resolved at `<resourcesPath>/bin` when packaged, else `<cwd>/bin` (`youtubeDownloader.ts:81-94`). No version pin; auto-update fires 5s after handler setup if version date ≥30 days old (`youtubeHandlers.ts:517-559`).
- Node: `child_process.spawn`, `https`, `http`, `fs`, `events`, `electron.app.getPath('userData'|'temp')`, `electron.dialog.showOpenDialog`.
- Network: yt-dlp egress to YouTube/SoundCloud/TikTok/Facebook etc.; direct `https.request` to facebook.com / scontent CDN; HTTPS `GET` to platform test URLs in `CookieManager.testCookies`.
- jobQueue (`backend/jobQueue/jobQueue`) for cancellable task lifecycle.

## Conventions and invariants
- yt-dlp args are passed as a JS array and spawned without a shell — never string-concat URLs/paths. Output templates use yt-dlp tokens (`%(uploader)s/%(title)s.%(ext)s`) joined with `path.join` so Windows backslashes are tolerated (`:1181`).
- Player client matters: the codebase deliberately uses `youtube:player_client=tv,android_vr,web_safari` as primary (DASH 4K, no PO token, no SABR); when saved YouTube cookies exist `getVideoInfoWithClient` falls back to `tv,web_safari` only (`:779-781, :1219, :1374, :2256`). Do not revert to plain `web` or `android`.
- Quality string in `getQualityFormat` is a multi-stage `format_id+audio/.../best` chain (`:585-619`); changing IDs without checking yt-dlp 2025 availability will silently degrade output.
- Cancel path: `youtube:cancel-download` prefers `jobQueue.cancelJob(currentYoutubeJobId)` and only falls back to `downloader.cancelDownload()` if no job id is tracked (`youtubeHandlers.ts:386-407`); `cancelDownload` SIGTERMs every entry in `activeProcesses` Map (`:1054-1072`).
- Only `downloadVideo`'s primary path registers its child process via `addProcess`. `downloadVideoWithArgsOnce`, `downloadVideoToFolder`, `getVideoInfoWithClient`, `getChannelVideos`, `getVersion`, and `updateYtDlp` use the legacy `this.currentProcess = proc` setter that no longer tracks anything (`:1441, :2306`) — those processes are NOT killed by `cancelDownload`.
- Retry backoff in `youtube:download-video` is a 3-attempt loop with `waitMs = attempt*3000` and a `RETRYABLE_YTDLP_ERROR_PATTERNS` allowlist (`youtubeHandlers.ts:17-32, 241-265`). The `await sleep(waitMs)` is unconditional — `ctx.signal.aborted` is only checked between attempts, not during the sleep.
- Facebook is treated as a separate platform: `isFacebookUrl` shortcuts inside `downloadVideo`, `getVideoInfo`, `getChannelVideos`, `getChannelInfo`, `downloadChannel` (`:747, :1156, :1676, :1841, :2161`). Facebook requires cookies in `CookieManager` (platform `'facebook'`) — without them every Facebook entry throws `Chưa import cookies Facebook`.
- Cookies for yt-dlp are materialized as Netscape-format text files in `app.getPath('temp')/media-tool-cookies/<platform>-cookies.txt` and **not deleted** — the file persists across runs (`cookieManager.ts:409-440`). Browser-extracted cookies via `browserCookieService` are deleted by the closure-bound `cleanup` after spawn finishes (`youtubeDownloader.ts:170-176`).
- `CookieManager.fetchWithCookies` and `FacebookScraper.fetch`/`postFetch`/`downloadVideo` all set `rejectUnauthorized: false` (`cookieManager.ts:463`, `facebookScraper.ts:152, 207, 786`).
- `youtubeHandlersRegistered` flag at module scope makes `setupYouTubeHandlers` idempotent across macOS dock-icon re-launches; cleanup must remove the same channel list and reset the flag (`:48, :596`).
- Subfolder layout for channels: `<outputDir>/<sanitizedChannelName>/{videos|audios}/[+thumbnails/]`. `videos|audios` switches on `audioOnly`; thumbnails folder only when `downloadThumbnail` (`:2063-2078`).
- Renderer parses URL lists via `extractUrlsFromText` regex; queue dedupes by URL string (`YouTubeDownloaderTab.tsx:11, 423-438`).

## Risks during refactor
- KNOWN ISSUE — cookies plaintext in temp: `CookieManager.writeCookiesFileForYtDlp` writes session cookies (`c_user`, auth tokens) unencrypted to `%TEMP%/media-tool-cookies/*-cookies.txt` and never unlinks them (`cookieManager.ts:413-440`).
- KNOWN ISSUE — Facebook cancel gap: `FacebookScraper.downloadVideo` and its `https.request` chain are not registered in `activeProcesses`; `cancelDownload()` cannot interrupt an in-flight Facebook download (`facebookScraper.ts:772-839`, `youtubeDownloader.ts:1054`).
- KNOWN ISSUE — retry sleep ignores cancel: `await sleep(waitMs)` between yt-dlp retry attempts is not racing `ctx.signal`; cancel during the 3–9 s wait stalls until the next attempt boundary (`youtubeHandlers.ts:253-263`).
- KNOWN ISSUE — TLS verify off: `rejectUnauthorized: false` on every Facebook scrape and cookie test request (`facebookScraper.ts:152, 207, 786`, `cookieManager.ts:463`).
- Stale process tracking: `downloadVideoWithArgsOnce`, `downloadVideoToFolder`, info/version/update spawns assign to `this.currentProcess` but that setter only stores `_legacyCurrentProcess`; `cancelDownload` reads `activeProcesses` so those children leak past cancel (`:43-51, :1441, :2306`).
- Map id mismatch: `addProcess` uses `dl-${Date.now()}` while jobQueue tracks its own `ctx.jobId`. Two near-simultaneous downloads in the same ms produce duplicate Map keys, silently dropping the earlier process from the cancel set (`:1258-1259`).
- `cancelDownload` clears the entire `activeProcesses` map regardless of which job invoked it; in concurrent batch mode (`downloadChannelConcurrent`) a single cancel kills all peers (`:1056-1072`).
- `currentYoutubeJobId` is a single module-level slot in `youtubeHandlers.ts:14`; concurrent video+channel jobs overwrite it, so `youtube:cancel-download` cancels only the most recent.
- Auto-update timer at `youtubeHandlers.ts:517` is unguarded by `mainWindow.isDestroyed()` until inside the callback — if `cleanupYouTubeHandlers` removes `downloader` first, the timer logs a warn but the closure still holds the stale `mainWindow`.
- `downloadVideo` has a fallback `fs.readdir(outputDir)` that picks any `.mp4|.webm|.mkv|.avi|.flv` file as the result if yt-dlp output didn't yield a `Destination:` line — risks returning an unrelated pre-existing file (`:1290-1297`).
- Two large divergent code paths (`downloadVideo` at `:1150` vs the legacy `downloadVideoWithArgsOnce` at `:1323`) duplicate the yt-dlp arg list with subtly different settings (`--concurrent-fragments 3`, `--ignore-errors`, `--continue`). `downloadVideoWithArgsOnce` appears unreferenced.
- Renderer keeps `useCookiesFromBrowser`+`cookiesBrowser` separate from CookieManager; the two cookie sources can collide when both are configured (`YouTubeDownloaderTab.tsx:65-67, 346`).

## Open questions
- Should the per-job process map key on `ctx.jobId` instead of `dl-<ts>` so cancel is scoped to the originating job?
- Are the legacy `downloadVideoWithArgsOnce` and `currentProcess` setter still needed, or can both be removed without behavior change?
- Should temp Netscape cookie files be deleted after each yt-dlp invocation (or written with restricted ACLs) instead of persisting in `%TEMP%`?
- Should `FacebookScraper` expose its in-flight `https.request` so `cancelDownload` can `req.destroy()` it?
- Is `rejectUnauthorized:false` required by any current network path, or is it a leftover from earlier debugging?
- Why does `getQualityFormat` ship `audio_id 140/251` for every video tier — is that documented elsewhere or load-bearing for ffmpeg merge?
- The 30-day staleness threshold for auto-update is hardcoded (`youtubeHandlers.ts:529`); should it be configurable per release channel?
