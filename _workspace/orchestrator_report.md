# Orchestrator Report — pending uncommitted changes (session review)

**Verdict: BLOCK until blocker + 3 highs fixed.** 4 specialists, 1 blocker, 3 high, 2 medium, 2 low. All blocker/high regressions were introduced THIS session by media-export edits that bypassed the harness — caught before ship.

## Summary

| # | Sev | Area | Issue | Owner |
|---|-----|------|-------|-------|
| 1 | 🔴 BLOCKER | media | `resolutionMismatch` rejects ALL 1080p (1080 vs H.264 coded 1088) | media |
| 2 | 🟠 HIGH | media | decode regex `non-monotonous dts` false-fails concat-copy | media |
| 3 | 🟠 HIGH | media | `validatePreTranscodedClips` throws whole export on 1 probe fail | media |
| 4 | 🟠 HIGH | IPC | `chromaKeyPreview` missing from IPCAPI type → tsc error | ipc |
| 5 | 🟡 MED | media | serial re-probe 3300 clips = 3-8 min stall | media |
| 6 | 🟡 MED | youtube | `dl-${Date.now()}` key collision (pre-existing) | youtube |
| 7 | 🟢 LOW | media | diskSpace unknown logs "Infinity GB" cosmetic | media |
| 8 | 🟢 LOW | autopilot | disk estimate relies on free===Infinity not info.unknown | autopilot |

## Confirmed GOOD (no regression)

- **`executeFinalExport` call sites aligned** — finalExport.ts:3390 (14 args) and autopilotRunner.ts:2074 (13 args) both map exactly to the new signature after subtitle/options removal. The earlier param-shift bug IS fixed. Verified by 2 independent specialists.
- `sharedTranscodedClipCache` move out of try — transparent to autopilot.
- youtube `currentProcess` removal — clean, zero leftover refs, register/remove symmetric.
- disk Infinity fail-open — handled sanely by checkMinimumSpace/assertMinDiskSpace/formatBytes and autopilot estimates.
- No renderer refs to removed subtitle/canvasScene on final-export payload.
- chromaKeyOverlay flows shared→payload→backend correctly.

## Fixes required (Phase 5)

1. **outputVerification.ts resolutionMismatch**: `(width !== codedWidth || height !== codedHeight)` → `(codedWidth < width || codedHeight < height)`. Coded ≥ display is normal macroblock padding; only coded < display is truncation. Still catches the user's real 1280-header/736-coded case.
2. **outputVerification.ts errorPattern**: drop `non[- ]?monotonous dts` and `premature end` from fatal regex (routine concat-copy warnings). Keep corrupt|invalid data|moov atom|could not find codec|truncated|missing picture|partial file.
3. **finalExport.ts validatePreTranscodedClips**: probe failure → non-fatal (keep old duration, log warning). Only throw on genuine resolution/codec/pix_fmt heterogeneity.
4. **finalExport.ts validatePreTranscodedClips**: batch the re-probe (concurrency 8) instead of serial.
5. **src/types/ipc.ts**: add `chromaKeyPreview` member to IPCAPI matching preload shape.

## Deferred (not blocking ship)

- #6 youtube key collision — pre-existing, low likelihood, separate fix.
- #7/#8 cosmetic/explicitness — optional.
- Dead `FinalExportRequestPayloadSchema` in ipcSchemas.ts (unused, drifted) — align or delete later.

## Verify after fixes

`npm run build` + `npx tsc --noEmit` (chromaKeyPreview error gone) + manual 1080p export smoke test on Tab 6.
