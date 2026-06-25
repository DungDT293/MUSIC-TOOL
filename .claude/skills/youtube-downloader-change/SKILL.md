---
name: youtube-downloader-change
description: Workflow for yt-dlp, YouTube/Facebook downloader, cookies, progress, channel downloads, retries, and media metadata changes.
---

# YouTube Downloader Change Workflow

Use when changing downloader backend, cookie handling, yt-dlp arguments, channel/batch downloads, metadata extraction, progress, or downloader UI contracts.

## Steps

1. Identify affected downloader path: video, channel, playlist, cookies, metadata, or UI.
2. Validate URLs before external tool execution.
3. Keep cookies and tokens out of logs and renderer exposure.
4. Check yt-dlp arguments and Windows path handling.
5. Check cancellation and progress events.
6. Use `youtube-downloader-specialist` for focused review.
7. Use `security-hardening-reviewer` for cookie/privacy-sensitive changes.
8. Verify with a small URL or mocked/manual smoke path.

## Checklist

- Output paths stay in user-selected directories.
- Retries are bounded.
- Network failures are readable.
- Cookie import/test/remove remains safe.
- Batch progress cannot attach to the wrong job.

## Report

Summarize behavior changed, privacy impact, verification, and risks.
