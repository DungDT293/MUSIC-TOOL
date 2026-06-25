# Autopilot log — resource signals

Source: `C:\Users\PC Gaming\AppData\Roaming\93-media-tool-mix-nhac\logs\autopilot.log` (44504 lines, 3.4 MB).

## Output folder location
Local drive `E:\` (no UNC, no network). Output audio paths follow pattern:
`E:\nguyen lieu nhac\tomo\audio\moi v2\<DDMM>\<DDMM>_P##.m4a` (line 4606).
All paths contain spaces (`nguyen lieu nhac`, `tomo`, `moi v2`, `vid anh Quyet`, `nl da cat`, `nl chuan hoa`, `nguyen lieu da cat chuan hoa`). No `\\?\` long-path prefix, no UNC `\\server`, no D:\ writes seen — everything routes through `E:\`. Job output filenames are simple `video N.mp4` (also contains a space).

## Source folder location
Sources live on the **same drive E:\** as output. Examples:
- `E:\vid anh Quyet\nl da cat` (line 276) — 1481 clips
- `E:\nguyen lieu nhac\nguyen lieu hugel\nl chuan hoa\nl moi nhat da chuan hoa\0904hugelmoi` and `\newest` and `\video veo3` (lines 1167-1184)
- `E:\nguyen lieu nhac\nguyen lieu hugel\veohugelmoi`, `\veo3 mới` (UTF-8 accent in path)
- `E:\nguyen lieu nhac\tomo\nguyen lieu da cat chuan hoa\nguyen lieu cu da cat` etc.

Source + output share spindle/SSD on `E:`. Read+write contention on the same drive is therefore possible.

## GPU vs CPU encoder
Every health-check line (40+ occurrences) reads:
> `Health-check OK: FFmpeg/FFprobe/AAC ready. Batch nay chi dung copy-stream video nen bo qua GPU encode test.`

The pipeline runs **stream-copy only** for video (no re-encode). No `nvenc`, `h264_nvenc`, `cuda`, `amf`, `qsv`, `libx264`, `hwaccel`, or `encoder=` strings appear in the log. GPU is intentionally not used; failures cannot be a GPU→CPU fallback artifact.

## Job 1 cold-start signals
First successful run, day 2304:
- Step 3 ends at `09:20:58` (sync 1481 clips done).
- Step 4 first progress for video 1 at `09:21:34` — ~36s pre-roll gap (probable concat/transcoded-clip prep before any progress).
- Video 1 progress 0% → 100%: `09:21:34 → 09:23:20` (~1m46s).
- Video 2: `09:23:23 → 09:25:20` (~1m57s).
- Video 3: `09:25:20 → 09:27:?` (~2m).

No "transcoded N clips" line precedes job 1 (search returned no match). Job 1 is **not noticeably slower** than jobs 2–10; per-job duration ~110s is consistent. The 36s gap between step-3 end and video-1 first progress is the only cold-start-shaped signal, but is short enough to be normal initialization, not a stall.

## Disk space signals
Zero hits for `ENOSPC`, `disk space`, `disk-space-warning`, `ensureCapacity`, `ensureFinalExportDiskCapacity`, `estimatePlaylistBytes`, `confirmResourcesForVideoJob`, `EACCES`, `EBUSY`, `EAGAIN`, `EMFILE`, `ENOENT`, `OOM`, `out of memory`. The autopilot log surfaces no resource-budget telemetry at all.

## Concurrent job signals
Strictly **sequential**. Lines `Đang xuất video N/10` advance one job at a time — video 1 hits 100% (`09:23:20`) before video 2 starts at 10.0% baseline (`09:23:23`). Same pattern across every day in the log. Audio playlists (Step 2) likewise serialize 1→10. No overlapping job IDs, no `concurrent`/`parallel`/`worker`/`pool`/`slot` mentions tied to scheduling.

## Quan sát thêm
- **Dominant failure mode**: `Output decode verification failed cho video N.mp4` — outputs are produced (Step 4 reaches 100% for every job) but Step 5 verification fails. This is post-export, not during encode. No `SIGTERM`/`SIGKILL`/`killed`/`timeout` ever logged; ffmpeg processes did not crash mid-run.
- **Pattern**: failures cluster — e.g. day 2304 first run loses jobs {1,2,3,4,5,6,10} keeping {7,8,9}; second run loses {1,3,5,6,7,8,9} keeping {2,4,10}; third run loses {1,2,3,5,6,7,8} keeping {4,9,10}. Different jobs fail each retry → not a deterministic source-file issue.
- **Anomaly run @15:52:49**: Step 2 playlist 3 jumps `0.0% → ✓ Đã xuất xong` instantly, both attempts, missing output file `2304_P03.m4a` — ffmpeg returned success but no file landed on `E:\`. Possible AV/Defender quarantine, antivirus lock, or ffmpeg writing to a path that was synchronously deleted. No EBUSY/EACCES surfaced.
- **Code-level errors (not resource)**: `sharedTranscodedClipCache is not defined` appears 30+ times across days 2304/0805/1205/1505/1605/2705 — a `ReferenceError` in transcoded-clip cache logic, ending day after ~30–50 minutes.
- **No GPU/CPU encoder switches**, **no disk pressure logs**, **no concurrency overlap**, **no Windows path-length errors**. The resource subsystem is silent — failures here are logical (verification) or programmatic (undefined symbol), not capacity-driven.

---

Saved: `e:\TOOL DUNG CODE\93-media-tool-mix-nhac\_workspace\log_resources.md`
