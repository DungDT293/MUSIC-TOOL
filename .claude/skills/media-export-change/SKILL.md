---
name: media-export-change
description: Workflow for changes to media export, FFmpeg commands, normalization, final export, progress, and cancellation.
---

# Media Export Change Workflow

Use when changing audio export, video final export, FFmpeg/ffprobe commands, normalization, muxing, output verification, progress, or cancellation.

## Steps

1. Identify the affected pipeline: music scan, playlist, audio export, video split/merge/normalize, final export, or renderer progress UI.
2. Read the current command construction and process lifecycle before editing.
3. Preserve existing duration behavior unless the user explicitly asks to change it.
4. Check Windows path handling, temp files, scratch dirs, and cleanup.
5. Check cancellation, active export tracking, and progress events.
6. Use `media-ffmpeg-architect` for a focused review when available.
7. Use `electron-ipc-specialist` when IPC channels or preload APIs changed.
8. Verify with the smallest relevant command or manual smoke check.

## Checklist

- Spaces and Unicode paths still work.
- Packaged app can locate media binaries.
- GPU fallback remains safe.
- Retry paths do not mark partial output as success.
- Cleanup runs on success, failure, and cancellation.
- Progress stays tied to the correct request id.

## Report

Summarize files changed, behavior changed, behavior preserved, verification, and remaining risks.
