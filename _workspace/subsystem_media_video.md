# Media — Video

## Purpose
Backend video pipeline for the Final Export feature: scan audio + video sources, plan per-audio jobs, build a concat playlist sized to audio duration, optionally normalize/transcode clips, mux audio onto a concatenated video, optionally chroma-key overlay, then verify the output. Supports manual export (Tab 6) and autopilot orchestration. Handles GPU/CPU encoder selection, cancellation, same-drive scratch, and partial-failure tolerance across multi-job runs.

## Entry points
- backend/video/finalExport.ts:3197 `exportFinalVideo` — called by `electron/handlers/videoFinalExportHandlers.ts:106` IPC `VIDEO_FINAL_EXPORT_REQUEST`; emits via `FinalExportEmitter`.
- backend/video/finalExport.ts:3180 `scanFinalExportVideo` — caller-side scan IPC.
- backend/video/normalizeVideo.ts:74 `normalizeVideo` — autopilot pre-pass to build concat-safe clip pool.
- backend/video/finalExport.ts:128 `generateChromaKeyPreview` — preview PNG for UI.
- backend/video/videoJobManager.ts:144 `videoJobManager` singleton — used by all spawn sites for cancel.

## Core data flow
1. Plan: `planFinalExport` scans audio (`loadAudioFiles`) and video (`loadVideoClips`) → `ExportPlan { jobs, videoClips, priorityVideoClips }`.
2. Per-job (sequential, finalExport.ts:1201): build `videoPlaylist` via `buildPlaylistToFillDuration` honoring `priorityVideoClips`, `mappedVideo` (strict 1:1), shuffle, and quarantine set.
3. Write concat list, then `runFinalCommand` (finalExport.ts:2332): branches at line 2379. With `normalizeVfFilter` → `runFinalCommand_TwoPass`; otherwise `runFinalCommand_SingleStep` with `-c:v copy` or `buildVideoEncoderArgsWithChoice`.
4. Two-pass: Pass 1 `preTranscodeClips` (finalExport.ts:1745) re-encodes each clip to uniform format using shared cache; Pass 2 concat-copy + audio mux (finalExport.ts:2623) with `-t totalDurationSec`.
5. Verify: `verifyOutputVideo` (probe + 60s decode window) and `runPlaybackTest` (mpv→vlc, only when `forceReencode`); failures throw and the job is logged in `failedJobs` while siblings continue.

## Key files
| file | role |
|---|---|
| backend/video/finalExport.ts | Planner, executor, two-pass orchestrator, chroma-key filter, scratch dir, tracklist |
| backend/video/normalizeVideo.ts | Autopilot clip-pool normalizer with manifest |
| backend/video/videoJobManager.ts | Singleton ChildProcess registry + cancel flag |
| backend/video/outputVerification.ts | ffprobe + decode-window correctness check |
| backend/video/playbackTest.ts | Optional mpv/vlc smoke test |
| backend/video/videoInfo.ts | ffprobe wrapper with 30s timeout |
| backend/video/videoUtils.ts | Sliding-window concurrent ffprobe validation |
| backend/video/videoProgress.ts | Progress payload builders for cut/merge/multi-cut |
| backend/video/utils/normalizeVf.ts | vf filter, concat-safe args, GPU hybrid CUDA filter |
| shared/videoFinalExportChannels.ts | IPC payload types + `EXPORT_PRESETS` |
| shared/canvasExportTypes.ts | Renderer-side scene description (canvas export, not used by current pipeline) |

## IPC channels touched
- `video:final-export:request`
- `video:final-export:progress`
- `video:final-export:done`
- `video:final-export:error`
- `video:final-export:scan-audio`
- `video:final-export:scan-video`

## External dependencies
- FFmpeg/ffprobe via `getFfmpegPaths()` (per-GPU `gpuInfo.ffmpegPath` overrides allowed) — `child_process.spawn` only.
- Node: `node:fs/promises`, `node:os`, `node:path`, `node:crypto`, Electron `app.getPath('userData'|'temp')`.
- Optional external players: `mpv`, `vlc` (PATH lookup, 30s timeout — playbackTest.ts:9).
- GPU detection: `backend/utils/gpuDetection.ts` (`buildVideoEncoderArgsWithChoice`, `getGpuInfo`); only NVENC has a fast path in `normalizeVideo` (normalizeVideo.ts:317–351).
- No network, no LLM.

## Conventions and invariants
- Cancellation contract: every spawn calls `videoJobManager.registerJob(requestId, proc)`; pollers re-check `isCancelled(requestId)` in stderr handlers and after `close`. `cancelledJobs` flag persists past process close so post-exit handlers see it; eviction is bulk at `MAX_CANCELLED_HISTORY=200` (videoJobManager.ts:7,30,58). Cleanup-on-close guards by proc identity to survive GPU→CPU re-registration of same `requestId` (videoJobManager.ts:31).
- needVideoReencode is decoupled from audio encode (finalExport.ts:2358–2367). `chromaKeyActive` is intentionally included so single-step path uses `buildVideoEncoderArgsWithChoice` and respects the user's GPU/CPU choice when filter_complex forces re-encode.
- Two-pass branch is taken only when `normalizeVfFilter` is set (unifyFormat). After encoder build, single-step strips `-hwaccel` and rewrites `-vsync 2` to `cfr` because concat demuxer rejects hw-decode (finalExport.ts:2401–2417).
- Pre-transcode cache is shared across all jobs in one export (finalExport.ts:806, passed at 1068); on missing-file rebuild, only missing entries are evicted to preserve valid ones (finalExport.ts:2543–2558, 2764–2779).
- Same-drive scratch: tempDir is created inside outputDir as `.93media-temp-<uuid>` so final rename is O(1); falls back to userData on permission failure (finalExport.ts:364).
- Output verification is mandatory: missing video stream, missing audio stream, duration drift > 5s, or decode failure throws (finalExport.ts:1123–1139). Decode timeout is treated as OK for large files (outputVerification.ts:108–112).
- Per-job try/catch — one failed job does NOT abort the export; failures are accumulated into `FinalExportDonePayload.failedJobs` (finalExport.ts:1201–1235). Total failure throws.
- normalizeVideo uses content-addressed output path `<base>_<sha1(profile)>_normalized.mp4` so resume via `skipExisting` is safe (normalizeVideo.ts:473).
- Concat-list path escaping is Windows-aware (forward slashes + quoted) — finalExport.ts:186.
- Disk pre-check before manual export only: `assertMinDiskSpace` at finalExport.ts:3223 — autopilot has its own checks.
- Deep verification (`runPlaybackTest`) only runs when `forceReencode` (finalExport.ts:1141).
- `priorityVideoClips` are excluded from `deleteSourceFiles` cleanup (finalExport.ts:1295–1299).

## Risks during refactor
- finalExport.ts:2367 — moving `chromaKeyActive` out of `needVideoReencode` reverts the just-fixed encoder-choice-respecting bug.
- finalExport.ts:806 — replacing the shared cache with per-job maps multiplies pre-transcode cost by `totalJobs` (regression FIX PERF-12).
- finalExport.ts:2401–2417 — removing the `-hwaccel` strip / `-vsync` rewrite breaks concat demuxer in single-step re-encode.
- videoJobManager.ts:31 — dropping the `proc === jobs.get(id)` identity check causes GPU→CPU fallback to delete the new process from the map.
- normalizeVideo.ts:317–351 — only NVENC has a fast path; AMD/Intel fall back to CPU silently.
- finalExport.ts:2535–2569 — Pass-1 rebuild logic depends on cache invalidation matching only missing files; broadening eviction corrupts shared cache for other jobs.
- outputVerification.ts:125 — error regex is intentionally narrow; widening (e.g. matching `error`) yields false negatives because `-v error` log level itself contains the word.
- finalExport.ts:1116 — verification is the only correctness gate; loosening any of the four checks ships broken outputs.
- shared/videoFinalExportChannels.ts:1–6 — channel constants are imported by both preload and handlers; renaming requires the preload-handler-shared-types triad in lock-step.
- normalizeVideo.ts:138 — `concatSafe` defaults to true; flipping it changes manifest semantics for existing autopilot caches.

## Open questions
- shared/canvasExportTypes.ts is wired into `FinalExportRequestPayload.canvasScene` but no backend code reads it — is canvas-export-engine deferred or dead?
- `runPlaybackTest` is gated to `forceReencode` only — is that intentional given two-pass also re-encodes (Pass 1)?
- `normalizeVideo` writes manifest only on `outputPaths.length > 0` — does autopilot tolerate a manifest-less success when every clip was `skipExisting`?
- Decode-window timeout of 90s is hardcoded — should very large outputs widen `decodeWindowSec` instead of relying on the timeout-as-OK shortcut?
- Subtitle plumbing in `FinalExportRequestPayload.subtitle` is rich, but `executeFinalExport` passes `undefined` for subtitle (finalExport.ts:3254) — is subtitle currently a no-op?
