# Media — Music

## Purpose
Backend subsystem that scans local audio libraries, builds duration-targeted playlists with priority/random/pinned tiers, deduplicates across sessions via an LRU pool, and renders concatenated or crossfaded audio files via FFmpeg. Also hosts standalone bitrate-normalize, audio-enhance (8-effect filter chain), Whisper transcription / subtitle generation utilities, and shared FFmpeg/disk/GPU helpers.

## Entry points
- `scanMusicFolders(payload, options)` — `backend/music/scanMusic.ts:254` — invoked by music IPC handlers; emits discover/probe progress.
- `buildPlaylists(options)` — `backend/music/playlistEngine.ts:281` — pure builder; persisted via `savePlaylists` at `:485`.
- `exportPlaylistToFile(req, progressEmitter)` — `backend/music/exportAudio.ts:221` — main render path; called by music export handlers.
- `validatePlaylistsForCrossfade(req)` — `backend/music/exportAudio.ts:1026` — pre-flight check (decode 2s of each track).
- `normalizeAudio(request, onProgress)` — `backend/music/normalizeAudio.ts:395` — batch bitrate convert; returns `jobId`.
- `enhanceAudio(req, onProgress)` — `backend/music/enhanceAudio/index.ts:69` — orchestrates filter chain over file batch.
- `renderPreviewClip(opts)` — `backend/music/enhanceAudio/previewRenderer.ts:92` — 2-pass loudnorm 30s clip.
- `transcribeAudio(audioPath, lang, onProgress, returnFull)` — `backend/audio/whisperTranscribe.ts:201`.
- `generateSubtitleFile(whisperResult, outPath, format, opts)` — `backend/audio/subtitleGenerator.ts:728`.
- `getSpotifyMeta(url)` — `backend/music/spotifyMeta.ts:57`.

## Core data flow
1. **Scan**: `scanMusicFolders` walks priority+random folders (symlink-cycle guarded `:84-104`), probes each file with concurrency=5 (`:276`), drops tracks `<5s` (`:231`), persists via `saveScanResult` and flags non-AAC files (`:354`).
2. **Build**: `buildPlaylists` partitions tracks by `folderType`+pinned, runs `sortByLRU` (3 tiers: never-used, >7-day, recent) `musicPool.ts:86`, then `buildSinglePlaylist` fills Pinned→Priority→Random→Emergency (`playlistEngine.ts:181-242`). `effectiveTargetSec` inflated by est. crossfade overlap when `crossfadeDurationSec` provided (`:299-305`).
3. **Export concat (no crossfade)**: pre-normalize per track if `loudnormEnabled` (`exportAudio.ts:367`), build concat list, stream-copy when all inputs are AAC and output is AAC (`:394`), else re-encode.
4. **Export crossfade**: estimate output duration; if short by >5s, auto-extend playlist by appending shuffled scan-result tracks (`:522-628`); pre-normalize; if `>8` tracks render in batches to WAV then crossfade batches (`:691-795`); single-pass `acrossfade` filter graph from `buildCrossfadeRenderArgs` (`:164`).
5. **Enhance**: `buildFilterChain` chains `NR→Gate→EQ→Comp→Exciter→Stereo→Loudnorm→Limiter` (`filterBuilder.ts:258`), runs once per file via `runEnhanceSingleFile`.

## Key files
| File | Role |
|------|------|
| `backend/music/scanMusic.ts` | Folder walk + ffprobe |
| `backend/music/scanStore.ts` | JSON cache at `~/.93-media-tool-mix-nhac/music-scan-result.json` |
| `backend/music/musicPool.ts` | LRU 3-tier pool in `userData/musicPool/musicPool.json` |
| `backend/music/playlistEngine.ts` | Playlist builder + persist `userData/playlists.json` |
| `backend/music/exportAudio.ts` | FFmpeg concat + crossfade renderer |
| `backend/music/exportHistory.ts` | Per-export tracklist log + tracklist.txt download |
| `backend/music/normalizeAudio.ts` | Per-job bitrate convert with cancel context |
| `backend/music/enhanceAudio/*` | 8-effect filter chain + 2-pass preview |
| `backend/music/spotifyMeta.ts` | oEmbed lookup (no auth) |
| `backend/audio/whisperTranscribe.ts` | CPU @xenova fallback after GPU faster-whisper |
| `backend/audio/whisperFasterService.ts` | Spawns `python faster_whisper_service.py` |
| `backend/audio/subtitleGenerator.ts` | SRT + ASS karaoke/word-pop/dynamic |
| `backend/ffmpeg/{config,probe,wrapper,gpuProfile}.ts` | FFmpeg path resolution, probe parser, spawn wrapper, dual-profile GPU lookup |
| `backend/utils/{diskSpace,cacheCleanup,gpuDetection}.ts` | Cross-platform free-space, version-gated cache clear, GPU smoke tests |

## IPC channels touched
Channel string constants are not declared in the read scope; usage is implicit via handler files. Comments reference `'music:normalizeAudio'` (`normalizeAudio.ts:392`). All other channels are owned by `electron/handlers/*` outside this subsystem.

## External dependencies
- `ffmpeg`/`ffprobe` binaries: dev `<root>/bin/`, prod `<resourcesPath>/bin/`; env override `FFMPEG_PATH`/`FFPROBE_PATH` (`ffmpeg/config.ts:24`). Modern/legacy GPU profiles via `ffmpeg-modern`/`ffmpeg-legacy` (`gpuProfile.ts:88`).
- `python` + `faster-whisper` package, optional CUDA (`whisperFasterService.ts:83`).
- `@xenova/transformers` dynamic import, model `Xenova/whisper-small` quantized CPU (`whisperTranscribe.ts:117`).
- Windows `wmic logicaldisk` then PowerShell fallback for free-space (`diskSpace.ts:51-110`); POSIX `df -k`.
- `nvidia-smi` for GPU name (`gpuDetection.ts:325`).
- `https://open.spotify.com/oembed` (no auth).
- Node `electron.app.getPath('userData')` for pool, history, playlists.

## Conventions and invariants
- **Audio export duration semantics are intentional.** `exportAudio.ts:335-340` clamps crossfade `1..10s` default `4`; `:299-305` inflates target by estimated overlap using avg track 210s; `:522-628` auto-appends extra tracks from scan result rather than padding silence; final probe at `:846` reports actual length; do not change.
- **Normalize overwrite guard (invariant).** `normalizeAudio.ts:273-291` refuses when output path resolves to input, AND when same dir + different extension + collision exists — prevents silent overwrites; must be preserved.
- **Enhance pipeline order is fixed.** `filterBuilder.ts:256-289`: NoiseReduction → NoiseGate → EQ → Compressor → Exciter → Stereo → Loudnorm → Limiter.
- **Playlist shuffle is non-deterministic.** `playlistEngine.ts:50` and `musicPool.ts:93` use `Math.random()`; `buildPlaylists` retries up to 30 times to avoid duplicate signatures (`:398`). LRU sort tiers stable, intra-tier shuffled. No seed parameter.
- **Per-job cancel for normalize, module-level for enhance.** `normalizeAudio.ts:55-89` keys cancel state by `jobId`; `enhanceAudio/ffmpegRunner.ts:13-26` is single-instance globals — concurrent enhance calls share cancel.
- **Disk-space check in export is warn-only.** `exportAudio.ts:262-296` deliberately does not block on `outputDir`; only the temp-dir estimate (`:307-318`) can fail-fast.
- **AAC stream-copy fast path.** `exportAudio.ts:391-408` skips re-encode iff `format==='aac'` and every input ext is `.m4a/.aac` — 20-50× speedup.
- **Windows long path.** `wrapper.ts:48-51,172-175` prefixes `\\?\` on local-drive paths >240 chars.
- **`windowsHide:true`** required on every `spawn` to prevent CMD flash (`wrapper.ts:63,185`, `normalizeAudio.ts:337`, etc.).
- **No `--amend`-style mutation of musicPool.** `markTracksUsed` only writes after successful build; `registerTracks` is additive (`musicPool.ts:127,157`).
- **Playlist persistence does not validate paths.** `loadPersistedPlaylists` skips `existsSync` to avoid 30s UNC stalls (`playlistEngine.ts:476-479`).

## Risks during refactor
- `exportAudio.ts:521-627` mutates `playlist` mid-render and saves original paths via `originalTrackPaths` (`:236, 893`) — history references would break if cleanup order shifts.
- `exportAudio.ts:915-930` `finally` cleans temp files via Set; any new code path that writes temp files outside `tempFiles.add` leaks.
- `enhanceAudio/ffmpegRunner.ts:13-15` module-level `currentProc` makes concurrent enhance jobs unsafe; mirrors the pre-fix bug noted in `normalizeAudio.ts:50-58`.
- `gpuProfile.ts:142` reads `appSettings` whose path is outside scope — refactor of settings could break GPU profile resolution silently.
- `whisperTranscribe.ts:152-192` strips WAV header by hardcoded 44 bytes — non-PCM/extended fmt chunks would corrupt the Float32 conversion.
- `subtitleGenerator.ts:286-292` interpolates word timings when Whisper returns segment-level only; downstream karaoke styles assume word data and emit warnings (`:308-313`).
- `diskSpace.ts:33-48` falls back to `C:` for network/UNC paths — a refactor that trusts `info.drive` may misreport.
- `backend/utils/pathUtils.ts` is **0 bytes** — any caller importing it relies on no exports.
- `playlistEngine.ts:453` lazy-requires `electron`; runs both in main and tests, fallback writes `.playlists.json` to `cwd()`.

## Open questions
- Should `enhanceAudio` adopt the per-job cancel pattern from `normalizeAudio` to support concurrent enhance batches?
- Are the 30-attempt retry and `Math.random()` shuffle in `playlistEngine` acceptable as non-deterministic, or should a seedable RNG be threaded for reproducible exports?
- Why does `crossfadeDurationSec` parsing live duplicated in `exportAudio.ts:335` and `:1030` instead of a shared helper?
- Is `playlistEngine.ts` `effectiveTargetSec` average of 210s a calibrated number or a placeholder, and what happens with libraries whose mean track length is far from it?
- `pathUtils.ts` is empty — was its API moved elsewhere or is something importing a missing symbol?
- Should `loadPersistedPlaylists` validate paths lazily on first track use instead of deferring entirely?
