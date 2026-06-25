# Forensic — "Output decode verification failed"

## "Output decode verification failed" throw site
- **`backend/video/finalExport.ts:1136-1138`** — `if (!verify.decodeOk) throw new Error(...)` inside `processJob` lambda.
- Single condition: `verify.decodeOk === false`. Other checks (`hasVideoStream`, `hasAudioStream`, `durationWarning`) are separate throws (lines 1122-1134).
- Call stack: `processJob` → caught by `for (const job of plan.jobs)` try/catch at line 1209 → logged as `Job N FAILED` and pushed to `failedJobs[]`. The error does NOT abort the export; remaining jobs continue. So "video 1.mp4 fail rồi retry pass" suggests autopilot-level retry is re-running the failed job, not in-process retry.

## verifyOutputVideo logic (`backend/video/outputVerification.ts`)
- Spawns: `ffmpeg -v error -t <decodeWindowSec> -i <outputPath> -f null -`.
- `decodeWindowSec` from caller: **60s for deep verify, 12s for shallow** (`getVerifyDecodeWindowSec`, finalExport.ts:1365). Job 1 with `forceReencode || normalizeVfFilter || needAudioEncode || normalizeAudio` → 60s.
- `decodeTimeoutMs = 90_000`. **Timeout = OK** (line 109-112: `safeResolve(true)` with comment "file lớn decode lâu hơn limit → coi là OK").
- `decodeOk = false` when: `code !== 0` **OR** stderr matches `/corrupt|invalid data|moov atom not found|could not find codec/i` (line 125).
- Explicit comment: do NOT match "error" / "failed" because `-v error` log level always echoes those.
- Decoder reads only first 60s — so any header-zone fault, missing moov, or first-segment corruption is what trips the regex.

## Pre-transcode cache flow
- File path built at line 2087: `path.join(tempDir, \`pre_${String(i).padStart(5,'0')}.mp4\`)`. `tempDir` = `<jobScratchDir>/two-pass` (line 2485). **Direct write** by FFmpeg child — no tmpfile + rename.
- `runAttempt` resolves only after `child.on('close')` fires AND `fs.statSync(outputFile)` returns `code === 0 && stats.size > 0` (lines 2017-2019). Cache set at line 2105 happens AFTER that.
- **No explicit `fs.fsync` / `fs.close` on the output file** — relies on FFmpeg process exit flushing OS buffers. Node child `close` event fires after process exit, so kernel-level write buffers are committed.
- Main concat reads via Pass 2 list `concat_pass2.txt` (line 2587-2595): each line `file '<pre_NNNNN.mp4>'\ninpoint 0\nduration <transcodedDurations[idx]>`. **The path points to the pre-transcoded file**, not the original.
- Pre-Pass2 guard: `findMissingPreTranscodedOutputs` (line 2535) calls `fs.statSync` → `isFile() && size > 0`. If anything missing → rebuild Pass 1 once. Same check after Pass 2 fails with `missingPass2Inputs` flag (line 2757).

## Job 1 vs Job N differences
- `sharedTranscodedClipCache` empty at job 1 → all clips encoded from scratch. Job 2+ may reuse same source paths and skip encoding.
- **GPU cold start** (lines 2042-2045): job 1 starts with `CONCURRENCY = 1` (GPU path) and `gpuSpeedMeasured = false`. After first NVENC clip succeeds, if `lastSpeedX >= 2` → bump to 2.
- **GPU speed watchdog** (90s, line 1925-1951): if no speed sample after 90s OR speed < 0.2x → kill + reject → fallback CPU + flips `gpuDisabledForRemainingClips = true` for the rest of this run. Job 1 is where this flip can happen mid-encode → some pre clips encoded by NVENC, rest by libx264 in the same playlist.
- Result: job 1's pre-transcoded clips may be a heterogeneous mix (NVENC + libx264) even though `buildConcatSafeOutputArgs` enforces uniform GOP/timebase. Concat-copy at Pass 2 may still see SPS/PPS variance between encoders → ffmpeg reports "Invalid data found" → matches the regex.

## Concat demuxer + duration directive
- Line 994-996 (Pass 1 input list) + 2588-2594 (Pass 2 list): `inpoint 0\nduration ${c.durationSec.toFixed(6)}`.
- `transcodedDurations[i] = clip.durationSec` from probe (line 2103, propagated from `parseClipsFromConcatList` which reads original probe value).
- Demuxer behavior: `duration` is a hard cap. If real transcoded file < `duration` → demuxer hits EOF early, ffmpeg may emit "Application provided invalid, non monotonically increasing dts to muxer" or "Invalid data". If real > `duration` → trailing frames truncated cleanly (no error).
- Pre-transcoded files are encoded from the FULL source (`-i clip.path`, no `-t`), so their actual duration ≈ source. If probe was wrong (VBR header inaccuracy, broken moov), the listed `duration` may not match → Pass 2 demuxer mismatch → invalid-data warnings into verify regex.

## Forensic on "video 1.mp4" log error
- By the time `verifyOutputVideo` runs at line 1115, Pass 2 ffmpeg has already emitted `close` (single-step at 3060, two-pass at 2696). Node's `child.on('close')` fires AFTER process exit → all stdio + file handles flushed by OS. `fsp.stat` at line 1090 already saw `size > 0`.
- So the file IS written. The verify failure is a **content** issue, not a write-race issue. The decode child reads the closed file, hits one of the four regex patterns ("corrupt" | "invalid data" | "moov atom not found" | "could not find codec") within the first 60s window.

## Hypothesis ranking
1. **Concat demuxer truncates due to bad probe duration (HIGH).** Evidence: `transcodedDurations` blindly copies probe `durationSec` into Pass 2 `duration` directive. Pre-transcoded mp4 actual duration may differ. First clip is most exposed because Pass 2 needs valid header from clip[0] for moov; mismatch produces "Invalid data found when processing input" → regex hit → `decodeOk=false`. Retry passes because re-run probes again with potentially different cache state, or the GPU is now warm and pre-transcode produces matching duration.
2. **NVENC cold-start with mid-job GPU→CPU fallback (MEDIUM).** Evidence: `gpuSpeedMeasured` flag (line 2110), `gpuDisabledForRemainingClips` (line 2138) only flips during job 1. Mixed-encoder pre clips → header variance at Pass 2 boundaries even with `buildConcatSafeOutputArgs`. Job 2+ runs entirely under one encoder (already disabled, or already warm), so it's stable.
3. **Pre-transcode write race / no fsync (LOW).** Evidence: there are TWO defensive `findMissingPreTranscodedOutputs` checks (lines 2535, 2761) and Pass 2 spawns its own ffmpeg child which would re-open + read the file. Node `close` event guarantees process exit + buffer flush. No reproducible code path where Pass 2 reads before flush.

## 5-line summary
- Throw is at `finalExport.ts:1137` triggered solely by `decodeOk === false`; verify regex is `corrupt|invalid data|moov atom not found|could not find codec`.
- Pre-transcoded files write direct (no tmpfile rename) but Node `close` event + explicit `findMissingPreTranscodedOutputs` stat-check make race unlikely.
- Job 1 differs: cold GPU watchdog can mid-flight flip to CPU, mixing encoders inside one Pass-2 concat list.
- Pass 2 list copies `clip.durationSec` from original probe into `duration` directive — any probe inaccuracy truncates the actual transcoded clip and emits "Invalid data".
- Top suspects: (1) probe-duration mismatch on Pass 2 concat, (2) NVENC cold-start mixing encoders in job 1, (3) write race — least likely.

Path: `e:\TOOL DUNG CODE\93-media-tool-mix-nhac\_workspace\log_decode_verify_code.md`
