# Orchestrator Report — 2026-06-13

**Diff scope:** 158 files (~24,800 deletions are intentional song-nhac removal; ~4,000 real insertions across media, IPC, autopilot, youtube, license, build).

**Verdict: BLOCK — merge after fixes.** 3 blockers, 8 highs.

## Summary

| Domain | Blockers | High | Medium | Status |
|---|---|---|---|---|
| Media / FFmpeg | 2 | 3 | 0 | Block |
| Electron IPC | 0 | 1 | 0 | Fix before merge |
| Autopilot | 0 | 3 | 0 | Fix before merge |
| YouTube downloader | 0 | 4 | 0 | Fix before merge |
| License / Auth / Server | 1 | 0 | 0 | Block (same root cause as build/release) |
| Build / Release | 1 | 2 | 0 | Block |
| Integration QA | folded into Electron IPC review | | | 1 contract drift caught |

The license and build/release specialists independently flagged the same `DEFAULT_POLICY_VERSION` blocker — counted once.

---

## Blockers (must fix before merge)

### B1 — `DEFAULT_POLICY_VERSION` lags shipped version
- **File:** [server/env.ts:26](server/env.ts#L26)
- **Issue:** Default `'4.1.0'` while [package.json](package.json) is on `4.4.0`. If D1 `version_policy` row is missing or unreachable, server reports stale `latest_version` and 4.4.0 clients see themselves "ahead of latest"; 4.1.x–4.3.x install base no longer flagged as below floor.
- **Fix:** Bump `DEFAULT_POLICY_VERSION` to `'4.4.0'`; review `min_supported_version`.
- **Verify:** `GET /api/version-policy` with empty D1 returns `latest_version === '4.4.0'`; 4.3.0 client through `auth:check` / `policy:get` shows upgrade prompt.
- **Owner:** cloudflare-license-specialist (server) / build-release-specialist (version sync)

### B2 — Invalid `import type` syntax in finalExport
- **File:** [backend/video/finalExport.ts:29](backend/video/finalExport.ts#L29)
- **Issue:** Nested `type` keyword inside `import type { ... }` block (`import type { ... type ChromaKeyOverlay }`) — fails TS compile and breaks the entire video export pipeline.
- **Fix:** Drop the inner `type` keyword (`ChromaKeyOverlay,`).
- **Verify:** `npx tsc --noEmit` passes.
- **Owner:** media-ffmpeg-architect

### B3 — `chromaKeyOverlay.offsetY` referenced but not in shared type
- **File:** [backend/video/finalExport.ts:~3251](backend/video/finalExport.ts#L3251) (single-step chroma branch)
- **Issue:** Code reads `chromaKeyOverlay!.offsetY`, but [shared/videoFinalExportChannels.ts](shared/videoFinalExportChannels.ts) has no `offsetY` field — only `position: 'center' | 'bottom'`. Compile error; at runtime the comparison evaluates `undefined === 0` and the else-branch produces `+NaN`.
- **Fix:** Either add `offsetY?: number` to the shared type and plumb from UI, or drop the offsetY logic and use the existing `position` like `buildChromaKeyFilterComplex` does elsewhere in the file.
- **Verify:** `tsc --noEmit` clean; dry-run a chroma export.
- **Owner:** media-ffmpeg-architect

---

## High-severity findings

### H1 — Single-step chroma branch silently switches encoder
- **File:** [backend/video/finalExport.ts](backend/video/finalExport.ts) (single-step chroma path)
- When `unifyFormat` / `needVideoEncode` is false, the original `videoCodecArgs` is `['-c:v','copy']`; the new branch silently re-encodes with libx264 CRF 22, bypassing the user's GPU/CPU encoder choice.
- **Fix:** Reuse `buildVideoEncoderArgsWithChoice(...)` when forcing re-encode for chroma; emit a log noting the upgrade.
- **Owner:** media-ffmpeg-architect

### H2 — `preTranscodeClips` parallel rewrite over-encodes
- **File:** [backend/video/finalExport.ts](backend/video/finalExport.ts)
- Workers grab indices via `nextIndex++` past the duration target before the early-exit fires, so extra clips beyond `minimumDurationSec` are fully transcoded (wasted CPU/GPU + orphan `pre_*.mp4` files).
- **Fix:** After slot collection, walk and break at threshold; `cleanupPreTranscodeOutput` for unused outputs.
- **Verify:** Long playlist where threshold hits at clip 5 of 200 — confirm ≤5 ffmpeg encodes total.
- **Owner:** media-ffmpeg-architect

### H3 — `normalizeAudio` can overwrite unrelated files
- **File:** [backend/music/normalizeAudio.ts:268-278](backend/music/normalizeAudio.ts#L268)
- `_normalized` suffix removed; if user picks output dir == input dir but different extension (wav→mp3), equality check passes and existing `track.mp3` from another source is silently overwritten.
- **Fix:** Keep `_normalized` suffix, or reject when `outputFile` exists and is not the input.
- **Owner:** media-ffmpeg-architect

### H4 — IPC contract drift: `chromaKeyPreview`
- **Files:** handler [electron/handlers/videoHandlers.ts:401](electron/handlers/videoHandlers.ts#L401), preload [electron/preload.ts:141-150](electron/preload.ts#L141), missing in [src/types/ipc.ts](src/types/ipc.ts) (~line 851 area). Renderer call site [src/pages/Video/FinalExportTab.tsx:1325](src/pages/Video/FinalExportTab.tsx#L1325) compiles only because of optional chaining `api?.chromaKeyPreview?.(...)` which masks the drift.
- **Fix:** Add `chromaKeyPreview(opts: {...}): Promise<{ ok: boolean; previewPath?: string; error?: string }>` to `IPCAPI`; drop the `?.` in the call site once typed.
- **Owner:** electron-ipc-specialist

> Note: All other new IPC pairs (`security:reportAntiDebug`, youtube cookie-* x5, `policy:get`, `autopilot:*`, `chromaKeyOverlay` payload) match across all four layers. Song-nhac removal is clean across preload, ipc.ts, handlers/index.ts, main.ts, allowed-channels list, and before-quit cleanup.

### H5 — Autopilot stale-lock recovery gated off
- **File:** [backend/autopilot/autopilotRunner.ts:624](backend/autopilot/autopilotRunner.ts#L624)
- Recovery clause requires `!activeRunToken`, but the case it should recover from is exactly when a prior crash left `activeRunToken` set. Status sticks on `running` forever.
- **Fix:** Drop the `!activeRunToken` clause; also null `activeRunToken` inside the recovery branch.
- **Verify:** Manually set `activeRunToken="x"`, `status="running"`, `lastHeartbeatAt = Date.now()-6*60*1000`; `startAutopilot` should proceed.
- **Owner:** autopilot-workflow-specialist

### H6 — Autopilot collision check uses non-deterministic projected paths
- **File:** [backend/autopilot/autopilotRunner.ts:1059](backend/autopilot/autopilotRunner.ts#L1059) (`buildProjectedAutopilotOutputPaths` via `assertNoAutopilotOutputCollisions`)
- Projected paths come from `generateSimpleTitles`, which calls `shuffleArrayInPlace` for non-custom presets — names checked at validation differ from names produced at runtime. False positives reject safe runs; false negatives miss real collisions when `autoCreateDailySubfolder=false`.
- **Fix:** Restrict check to deterministic title sources, or move the collision check to runtime right after `outputNames` is computed in `runAutopilotForDay`.
- **Owner:** autopilot-workflow-specialist

### H7 — Dead duplicate `startAutopilotLegacy` (498 lines)
- **File:** [backend/autopilot/autopilotRunner.ts:2658](backend/autopilot/autopilotRunner.ts#L2658)
- Unreferenced duplicate of `startAutopilot`. Future fixes to status, cancellation, runToken, or progress will silently drift between the two paths.
- **Fix:** Delete `startAutopilotLegacy` and the stale comment at line 142.
- **Verify:** `grep -nR "startAutopilotLegacy"` returns zero refs; `npm run test -- tests/unit/backend/autopilotRunner.test.ts` passes.
- **Owner:** autopilot-workflow-specialist

### H8 — TLS validation disabled while transmitting auth cookies
- **File:** [backend/youtube/cookieManager.ts:463](backend/youtube/cookieManager.ts#L463)
- `rejectUnauthorized: false` on `https.request` while sending full auth cookies (c_user/xs/sessionid/etc) to facebook.com / tiktok.com / instagram.com / youtube.com. MITM can capture session tokens.
- **Fix:** Remove the flag; default cert verification.
- **Owner:** youtube-downloader-specialist + security-hardening-reviewer

### H9 — Facebook downloads ignore cancel
- **Files:** [backend/youtube/youtubeDownloader.ts:1054](backend/youtube/youtubeDownloader.ts#L1054) (`cancelDownload`) + line 240 (`downloadFacebookVideo`)
- `facebookScraper.downloadVideo` is never registered in `activeProcesses`; `cancelDownload()` only kills yt-dlp. In-flight Facebook reels / batches keep running after the user clicks cancel.
- **Fix:** Thread an `AbortSignal`/cancel token into `FacebookScraper.downloadVideo`; `cancelDownload()` invokes it; break the batch loop on cancel.
- **Owner:** youtube-downloader-specialist

### H10 — yt-dlp retry sleep ignores cancel
- **File:** [electron/youtube/youtubeHandlers.ts:239-265](electron/youtube/youtubeHandlers.ts#L239)
- Retry-on-network-error loop uses `await sleep(waitMs)` (3s, 6s) without observing `ctx.signal`; cancel during backoff is ignored and a brand-new yt-dlp attempt launches after cancellation.
- **Fix:** Race `sleep` against the abort signal; re-check `ctx.signal.aborted` before next attempt.
- **Owner:** youtube-downloader-specialist

### H11 — Cookie file persists in predictable temp path
- **File:** [backend/youtube/youtubeDownloader.ts:125-131](backend/youtube/youtubeDownloader.ts#L125) (`resolveCookieArgsForYtDlp`, cookie-manager branch)
- Returns `cleanup: () => {}`. Netscape file written by `CookieManager.writeCookiesFileForYtDlp` (`%TEMP%/media-tool-cookies/{platform}-cookies.txt`) remains on disk in plaintext after every call. Predictable path, readable by other local users on shared Windows boxes.
- **Fix:** Delete file in close handler (regenerated next call) or write under `userData` with restricted ACL.
- **Owner:** youtube-downloader-specialist + security-hardening-reviewer

### H12 — Domain cutover risk in env example + wrangler
- **Files:** [.env.production.example:10-14](.env.production.example#L10), [server/wrangler.toml:8](server/wrangler.toml#L8)
- `LICENSE_SERVER_BASE` / `AUTH_BASE` documented for the `admin93media.xyz` cutover, but no note on which side consumes them and previous default-fallback comment was removed. Meanwhile `workers_dev=true` with commented routes means production stays on `*.workers.dev` until Dashboard route is attached manually — risk of shipping 4.4.0 pointed at a domain not yet live.
- **Fix:** Add a one-line comment clarifying these are renderer/electron build-time vars; confirm a `workers.dev` fallback still exists; attach Dashboard route before flipping installer envs (or keep `workers.dev` in the example until cutover).
- **Verify:** `curl https://admin93media.xyz/api/version-policy` returns 200 before release.
- **Owner:** build-release-specialist + cloudflare-license-specialist

---

## Cross-cutting issues

- **B1 (`DEFAULT_POLICY_VERSION`)** flagged by both license and build/release specialists — the version-pin lives in server but the impact is shipping the desktop installer.
- **B3 (`chromaKeyOverlay.offsetY`)** is also a cross-layer fix: the shared type in [shared/videoFinalExportChannels.ts](shared/videoFinalExportChannels.ts) needs an opt-in field if the offsetY behavior is intentional, then plumbed from UI through IPC. Currently treated as a media bug; if the field is added, IPC contract review applies.
- **H4 (`chromaKeyPreview` IPC drift)** — preload exposes a method the renderer types do not declare. The `?.` chaining in the call site hides this.

## Recommended next actions (ordered)

1. **media-ffmpeg-architect** — fix B2 (TS syntax), B3 (`offsetY` type/plumbing decision), then H1–H3.
2. **cloudflare-license-specialist + build-release-specialist** — fix B1 (version pin); then H12 (domain cutover documentation).
3. **electron-ipc-specialist** — fix H4 (`chromaKeyPreview` in `IPCAPI`).
4. **autopilot-workflow-specialist** — fix H5 (recovery gate), H6 (collision check), H7 (delete legacy).
5. **youtube-downloader-specialist** (with security-hardening-reviewer review) — fix H8 (TLS), H9 (cancel), H10 (sleep race), H11 (cookie file).

Re-run orchestrator after the blockers + H4 are patched; the remaining highs can land in a follow-up if scoped tightly.

## Verification commands

```bash
npx tsc --noEmit                      # catches B2, B3, H4
npm run lint
npm run build
npm run test -- tests/unit/backend/autopilotRunner.test.ts   # for H5–H7
# Manual:
#   cancel a Facebook batch mid-download (H9)
#   cancel during yt-dlp retry backoff (H10)
#   inspect %TEMP%/media-tool-cookies/ after a download (H11)
#   GET /api/version-policy on a fresh DB (B1)
#   Export with chroma + copy mode, verify encoder choice (H1)
```

---

## Harness notes (for the architect)

- The 9 pre-existing specialist agent files in `.claude/agents/` did NOT register as available `subagent_type` values in this session — only `integration-qa` (created today) was discoverable. This run worked around it by spawning `general-purpose` agents with the specialist role inlined. Worth investigating why the older `.md` files aren't being picked up; once fixed, the orchestrator's `Agent(subagent_type: "<specialist-name>")` calls work as designed.
- IPC integration-qa pass was folded into the electron-ipc-specialist review for this run (they overlapped fully on the changed channel set). For future runs with broader IPC churn, run them as separate passes per the orchestrator spec.
