# Autopilot

## Purpose
Multi-day batch orchestrator that scans music folders, builds N playlists per day, exports them to AAC, picks ~X% of the available video clips through an LRU "video pool" with sequence-fingerprint deduplication, and drives `finalExport` to mux audio+video into N output MP4s. Runs as a singleton in the Electron main process; UI talks to it only over IPC.

## Entry points
- `electron/handlers/autopilotHandlers.ts:38` — `registerAutopilotHandlers` wires all `autopilot:*` IPC and broadcasts progress/log to every BrowserWindow.
- `electron/handlers/autopilotHandlers.ts:54` — `autopilot:start` runs `runAutopilotHealthCheck` then fires `startAutopilot` background-style and returns after a 200 ms grace.
- `backend/autopilot/autopilotRunner.ts:616` — `startAutopilot(config, prepared?)` is the canonical pipeline entry.
- `backend/autopilot/autopilotRunner.ts:994` — `validateAutopilotStartConfig` (folder + dateCode + collision check) used by both legacy and new entry.
- `backend/autopilot/autopilotRunner.ts:551` — `forceResetAutopilot` IPC escape hatch.

## Core data flow
1. **Validate + scan** (Step 1): `validateAutopilotStartConfig` → `scanMusicFolders({priorityFolder, randomFolder})` once for the whole run with progress + 10-min timeout (`autopilotRunner.ts:693-753`).
2. **Per-day playlist build** (Step 2): `buildPlaylists` with optional `crossfadeDurationSec` to inflate target duration, then `savePlaylists` (`autopilotRunner.ts:2238-2257`).
3. **Per-playlist audio export** (Step 2 cont.): `exportPlaylistToFile` to `{dateCode}_P{NN}.m4a` with stall heartbeat, 30-min timeout, 2-attempt retry, fatal-error short-circuit (`autopilotRunner.ts:2272-2377`).
4. **Video pick + pool dedup** (Step 3): `pickVideosFromFolders` (recursive scan, in-place Fisher–Yates, max(min,X%) slice) → `syncPoolWithFiles` → `pickUniqueSequence` returns LRU-shuffled paths + fingerprint, with random-shuffle fallback on pool error (`autopilotRunner.ts:2410-2487`).
5. **Final export + pool commit** (Steps 4-5): `runExportVideoWithOptions` calls `planFinalExport` then `executeFinalExport`; on success, output files are stat-verified and `markClipsUsed` writes the session fingerprint (`autopilotRunner.ts:2092-2138`, `:2651-2659`).

## Key files
| file | role |
|---|---|
| `backend/autopilot/autopilotRunner.ts` | Singleton state, pipeline, logging, day loop |
| `backend/autopilot/healthCheck.ts` | FFmpeg/FFprobe/AAC + GPU smoke test before start |
| `backend/autopilot/videoPool.ts` | LRU pool (md5 of basename+size) + 50-clip SHA-256 sequence fingerprint, atomic JSON in `userData/videoPool` |
| `electron/handlers/autopilotHandlers.ts` | IPC + cross-window broadcast |
| `src/pages/AutopilotPage.tsx` | Plan-mode UI, day plans, log dedupe |
| `src/pages/Autopilot/BatchModeTab.tsx` | Multi-genre batch driver, persists to `BATCH_STORAGE_KEY` |
| `src/pages/Autopilot/PoolMonitorTab.tsx` | Read-only pool stats panel |
| `tests/unit/backend/autopilotRunner.test.ts` | `validateDateCode`, log buffer tests |

## IPC channels touched
- `autopilot:status`, `autopilot:log` (broadcast)
- `autopilot:getStatus`, `autopilot:getRecentLogs`, `autopilot:getLogVerbosity`, `autopilot:setLogVerbosity`
- `autopilot:start`, `autopilot:cancel`, `autopilot:forceReset`
- `autopilot:scan-video-folders`, `autopilot:video-pool-stats`, `autopilot:video-pool-clear`

## External dependencies
- `node:child_process` (health-check spawns ffmpeg with `windowsHide:true`).
- `getFfmpegPaths`, `getGpuInfo`, `buildVideoEncoderArgsWithChoice`, `buildNormalizeCudaHybridVfFilter` from sibling subsystems.
- `backend/music/{scanMusic, playlistEngine, exportAudio}` and `backend/video/{finalExport, videoJobManager}`.
- `backend/utils/diskSpace` (ENOSPC classifier + drive free check).
- `electron.app.getPath('userData')` for log dir + pool JSON; falls back to `process.cwd()` outside Electron.
- No network calls.

## Conventions and invariants
- Singleton module state: `currentProgress`, `activeRunToken`, `lastHeartbeatAt`, `activeAbortControllers`, `recentLogs`. There is at most one autopilot run per process.
- **Stale-lock recovery**: a run that crashes between setting `activeRunToken` and the `finally` clearing it leaves the token non-null forever. The recovery branch at `autopilotRunner.ts:625-640` therefore does **not** gate on `!activeRunToken` — it triggers on `lastHeartbeatAt > 0 && staleDuration > STALE_LOCK_TIMEOUT_MS` and nulls the token itself.
- `STALE_LOCK_TIMEOUT_MS = 5 min` (`:145`): the longest legitimate gap between `emit()` calls (audio export stall warns at 60 s, FFmpeg progress logged every ≤20 s); anything beyond 5 min implies the run is dead.
- Heartbeat is updated inside every `emit()` (`:295`), so any progress update keeps the lock alive.
- Audio output filename pattern is fixed: `{dateCode}_P{NN}.m4a`. Step 3 must accept `.aac` fallback when collecting paths (`:2506-2518`) — keeping that in sync with the verify step is mandatory.
- Output collisions: when `autoCreateDailySubfolder=false`, `assertNoAutopilotOutputCollisions` projects every per-day filename and rejects the run if any collide (`:954-991`).
- Video pool API order: `syncPoolWithFiles` → `pickUniqueSequence` (returns shuffled paths) → reassign `selectedVideoPaths` (do not mutate) → `markClipsUsed` only **after** export succeeds (`:2468`, `:2651`).
- Pool fingerprint is `sha256(first 50 clipIds joined by ',')`, store keeps last 500 sessions (`videoPool.ts:65-66, 153-156`).
- `cancelAutopilot` only kills jobs whose `requestId.startsWith('autopilot-')` (`:155-161`); other in-flight video jobs are untouched.
- `isFatalExportError` short-circuits retry on ENOSPC/EACCES/EPERM/ENOENT/EROFS/EMFILE/ENFILE plus FFmpeg exit codes 69/73/74 plus Vietnamese app-message keywords (`:1235-1286`).
- `startAutopilotLegacy` (`:2662-2932`) is a 498-line dead duplicate, never imported anywhere.
- `__autopilotTestUtils` (`:472`) is the only sanctioned way to reset singleton state in tests.

## Risks during refactor
- `autopilotRunner.ts:625` recovery branch is now token-agnostic; reintroducing a `!activeRunToken` guard reopens the permanent-lock bug.
- `autopilotRunner.ts:2272-2377` audio retry loop must continue to honor `isCancelling`, `controller.signal.aborted`, and `isFatalExportError` before retrying — otherwise a disk-full error retries 30 minutes.
- `autopilotRunner.ts:2468` reassignment of `selectedVideoPaths` is what carries the LRU-shuffled order into the final-export job; mutating in place there would silently restore alphabetical/scan order.
- `autopilotRunner.ts:2433-2443` rejects when `selectedVideoPaths.length < playlists.length`, but `pickVideosFromFolders` does **not** consider playlist count when computing `targetCount`; configs with `playlistCount > minVideoClipsTarget` and small folders can fail late.
- `videoPool.ts:386-407` shuffle-until-unique loop keeps the last shuffle even when collision-attempts exhaust (still flagged in `orchestrator_report.md`); pool log claims unique while fingerprint may collide.
- `autopilotRunner.ts:2622` reads `resolvedGpuEncoder.toUpperCase()` without optional chaining branching — if a future health-check shape change drops the field, log build throws inside the `done` block.
- `getStorageDir` in `videoPool.ts:71-79` and `getLogDir` in `autopilotRunner.ts:178-187` both fall back to `process.cwd()` when Electron is absent; tests run against the repo root unless overridden.

## Open questions
- Should `startAutopilotLegacy` (`autopilotRunner.ts:2662-2932`) be deleted outright? It is unreferenced and diverges from the recovery branch above.
- Is the 5-min `STALE_LOCK_TIMEOUT_MS` still right now that audio export timeout is 30 min — does a stuck-but-emitting export look healthy because `emit()` from FFmpeg progress refreshes the heartbeat?
- The shuffle-until-unique loop in `videoPool.ts:395` can settle on a known-colliding fingerprint after `maxAttempts`; is the "≈ 0 probability" assumption still acceptable for the smaller pools real users hit?
- `pickVideosFromFolders` uses `Math.max(minTotal, percentCount)` ignoring `playlists.length`; should the floor lift to `Math.max(minTotal, playlists.length)` so step-3 cancellations don't fail mid-day?
- `autopilot:scan-video-folders` re-implements directory walk distinct from `collectVideoFilesRecursive`; intentional duplication or candidate for unification?
