# FFmpeg/ffprobe error extraction — autopilot.log (44504 lines)

Source: `C:\Users\PC Gaming\AppData\Roaming\93-media-tool-mix-nhac\logs\autopilot.log`
Search keywords (all): `corrupt`, `invalid data`, `moov atom`, `could not find codec`, `Error while`, `Failed to`, `[mov,mp4`, `[concat`, `non monotonic`, `non-monotonous`, `dts`, `pts`, `truncated`, `decode error`, `Cannot`, `unable`, `codec_name`, `verifyOutput`, `decodeOk`, `durationDiff`, `durationWarning`, `pre_`, `preTranscode`, `transcoded`, `scratch`, `concat list`, `videoListFile`, `ffmpeg `, `ffprobe `, `NVENC`, `cuda`, `OOM`, `ENOSPC`, `EBUSY`, lowercase ffmpeg/ffprobe.

**Critical finding: zero raw FFmpeg/ffprobe stderr is logged.** The autopilot.log only contains pre-formatted progress lines, the Vietnamese wrapper "Output decode verification failed cho video N.mp4", and a JS ReferenceError. None of `[verifyOutput]`, `decodeOk`, `durationDiff`, `codec_name`, `[mov,mp4`, `[concat`, `dts`, `moov`, `Invalid`, `corrupt`, `Failed to`, `Error while`, `truncated` — no hits at all. The verifier swallows ffprobe output.

## Verify output samples

No `[verifyOutput]` log lines exist. The only duration data printed for outputs is the Báo Cáo summary, only for PASS files.

PASS samples (duration in minutes — file produced, decode OK):
- `video 1.mp4` 62.8 (line 777), `video 3.mp4` 64.6 (779), `video 7.mp4` 60.8 (783), `video 8.mp4` 62.1 (784), `video 10.mp4` 62.1 (786). All cluster 60.0–64.7 min, target 60 min — ~0–8% over target, normal copy-stream concat overshoot.

FAIL samples — no duration printed. Wrapper rejects file before it's measured. Examples:
- L1555 Job 1 video 1.mp4 — fail; L1560 Job 6 — fail; L1561 Job 10 — fail. No size/fps/codec/durationDiff.

So we cannot tell whether failed files are short, malformed, or fine-but-mis-probed; the verifier signature is hidden.

## Distinct error signatures

| Signature | Count | Where |
|---|---|---|
| `Output decode verification failed cho video N.mp4` (wrapper, no inner cause) | ~410 hits across runs | Bước 5, every failing day |
| `sharedTranscodedClipCache is not defined` (JS ReferenceError) | 26 day-fails | Days 2304, 0805, 1205, 1505, 1605, 2705, 0206, 1006, 1106 — Autopilot dies before/during prepare |
| `Export audio playlist 3 reported success but output file not found: E:\…\2304_P03.m4a` | 2 (one day) | Bước 2, audio playlist export — silent ffmpeg success but file absent |
| `Thư viện (287 phút) không đủ cho 10 playlist × 60 phút` | many | benign warn |

That is the entire distinct error set. No FFmpeg stderr leak, no ffprobe leak.

## Stage analysis

Failures land at exactly two stages:

1. **Bước 5 verify** (post-final-export). Bước 4 progress reaches 100% (e.g. L1550–1553) then immediately L1554 "⚠️ Ngày X: 3/10 video thành công" with per-job "Output decode verification failed". Encode completes, verify rejects. Job 1 fails on almost every day (L1555, 2358, 3258, 3870, 4518, 5358, 6209, 7108, 7684, 9749, 11498, 12084, 12717, 14100, 15838, 17646, 19311, 20278, 20896, 21519, 23798, 24772, 26315). Suspicious: first job in a batch is the most frequent failure.

2. **Day-level ReferenceError** `sharedTranscodedClipCache is not defined` (L788, 27845, 28398, 28980, 29529, 30077, 30630, 31173, 31798, 32467, 33096, 33681, 34158, 34765, 35380, 35908, 36476, 36900, 37510, 37894, 38489, 39056, 39672, 40276, 40816, 41339, 41880, 42410, 43183, 43865, 44492). Day 2304 first hit: 10/10 reach Báo Cáo summary as ✓ (lines 776–786) but the runner still throws after reporting — the throw is at autopilot finalisation, not per-job. Days 0805/1205/1505/1605/2705/0206/1006/1106 hit it earlier (no Báo Cáo).

Other one-off: L4606–4609 audio playlist 3 — ffmpeg returns 0 but `2304_P03.m4a` not on disk. Single occurrence.

## Pre-transcode signals

Zero hits for `pre_`, `preTranscode`, `transcoded`, `transcoded clip`, `skipExisting`, `scratch`, `concat list`, `videoListFile`, `cache`. The autopilot.log carries no breadcrumb from any pre-transcode/cache stage — either that stage doesn't run on this batch (health-check says "Batch nay chi dung copy-stream video nen bo qua GPU encode test", L2 etc.) or its diagnostics aren't routed into this log file.

The `sharedTranscodedClipCache` symbol implies a transcoded-clip cache module exists in code and is being referenced before declaration/initialisation — likely a top-level binding lost in a refactor (matches deleted `backend/video/songNhacFfmpegPipe.ts` / `electron/handlers/songNhacHandlers.ts` in current git status).

## Quan sát thêm

- No `NVENC`, `cuda`, `gpu`, `OOM`, `ENOSPC`, `EBUSY`, `EACCES`, UNC-path, network-drive markers. All paths are local `E:\` and `e:\` drive letters.
- VideoPool grows monotonically across runs (1481 → 12847 → 13388 → ...) — no eviction warnings; not the cause.
- Health-check always passes ("FFmpeg/FFprobe/AAC ready") immediately before every failing run — binary/codec presence not the issue.
- Job 1 over-represented in failures suggests state on first iteration (warm-up, leftover output stub, or first-clip prepare path).
- Bước 4 progress for Job 1 sometimes shows oscillation: 99.5% → 97.9% → 99.9% (L1546–1548) — single ffmpeg pass, but progress regression hints at stderr `time=` going backward, possibly non-monotonic timestamps in concat input. ffmpeg likely emitted "Non-monotonic DTS" warnings that were never captured.
- The "audio playlist reported success but output not found" (L4606) is the same shape as the video verify failure: ffmpeg exits 0 but downstream check fails — points to a write/flush/atomic-rename race in the export wrapper, not codec corruption.

## Bottom line

The log proves only that `verifyOutput` rejects files; it does **not** prove what's wrong with them. The verifier is opaque — it must be made to log ffprobe's actual `format`/`stream`/`codec_name`/`duration` and the durationDiff / decode probe output before any further root-cause work. Two real bugs to fix immediately:

1. JS ReferenceError `sharedTranscodedClipCache is not defined` — clear regression, blocks 26 day-runs.
2. Verifier swallows reason — pipe ffprobe stderr/stdout into autopilot.log so future log-mining is meaningful.

Output file: `e:\TOOL DUNG CODE\93-media-tool-mix-nhac\_workspace\log_ffmpeg_errors.md`
