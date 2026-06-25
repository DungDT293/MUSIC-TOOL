---
name: autopilot-change
description: Workflow for Autopilot orchestration, day plans, progress, logs, cancellation, media job sequencing, and recovery behavior.
---

# Autopilot Change Workflow

Use when changing Autopilot config, day plans, orchestration, logs, progress, cancellation, media sequencing, or recovery behavior.

## Steps

1. Map the affected step and dependent media modules.
2. Check folder config validation before work starts.
3. Check progress, logs, and status transitions.
4. Check cancellation stops active work and reports final state.
5. Check active export tracking so auth/update teardown is delayed.
6. Use `autopilot-workflow-specialist` for workflow review.
7. Use `media-ffmpeg-architect` for media pipeline changes.
8. Verify with a minimal day-plan smoke checklist or targeted tests.

## Checklist

- Steps do not silently skip required work.
- Logs are useful but do not leak more private data than needed.
- Batch loops are bounded and memory-safe.
- Failures are user-recoverable.
- Custom titles, ratios, pinned tracks, and GPU options stay consistent.

## Report

Summarize workflow impact, failure recovery, verification, and remaining risk.
