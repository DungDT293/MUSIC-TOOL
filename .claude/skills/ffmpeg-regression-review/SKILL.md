---
name: ffmpeg-regression-review
description: Review pending FFmpeg/media changes for command, duration, muxing, retry, cleanup, cancellation, and output verification regressions.
---

# FFmpeg Regression Review

Use to review diffs touching `backend/music`, `backend/video`, `backend/ffmpeg`, media IPC, or renderer progress for media jobs.

## Review lenses

1. Command construction and argument order.
2. Windows path handling.
3. Duration and timestamp semantics.
4. Codec/container compatibility.
5. GPU/CPU fallback behavior.
6. Retry classification.
7. Temp file lifecycle.
8. Cancellation and abort behavior.
9. Progress reporting.
10. Output verification before success.

## Process

1. Inspect changed files.
2. Identify the exact pipeline step changed.
3. Compare old and new assumptions.
4. Use `media-ffmpeg-architect` for focused review.
5. Use `electron-ipc-specialist` if IPC changed.
6. Produce high-confidence findings first.

## Report

For each finding include severity, affected file/function, what breaks, why, minimal fix, and suggested verification.
