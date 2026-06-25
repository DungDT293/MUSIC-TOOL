---
name: integration-qa
description: Verify Electron IPC contract integrity across preload, src/types/ipc.ts, electron/handlers registration, and shared/*Channels.ts. Trigger whenever IPC handlers, preload exposure, channel constants, or renderer-side IPC types change, and before any release. Also trigger when reviewing a PR that touches two or more of those layers, or when a bug report mentions "channel not found", "handler is not a function", "window.api.* undefined", or silent IPC failures.
---

# Integration QA Workflow

Use this skill to verify that every Electron IPC channel is consistent across all four layers it touches:

1. `electron/handlers/*Handlers.ts` — `ipcMain.handle` / `ipcMain.on` implementation
2. `electron/handlers/index.ts` — handler module registration
3. `electron/preload.ts` — `window.api` wrapper exposure
4. `src/types/ipc.ts` — `IPCAPI` interface declaration
5. `shared/*Channels.ts` (when present) — channel constant referenced by both sides

A change to any one of these without the matching update in the others ships a silent break.

## When to use

- After any diff under `electron/handlers/`, `electron/preload.ts`, `src/types/ipc.ts`, or `shared/*Channels.ts`.
- Before a release build (paired with `release-safety-check`).
- When a renderer feature reports `undefined is not a function`, `channel not registered`, or progress/cancellation events not arriving.
- When the harness orchestrator requests cross-layer integrity review.

## Steps

1. **Scope the diff.** Read `git diff` (or the listed changed files) and extract the set of channel names, handler functions, and `IPCAPI` methods touched.
2. **Build a four-corner table** for each affected channel: handler file, registration line in `index.ts`, preload wrapper, `IPCAPI` method.
3. **Open both sides at once.** For each row, read the matching pair (handler ↔ preload, preload ↔ ipc types). Do not certify a channel by reading only one side.
4. **Compare names AND shapes.** A matching channel string with mismatched parameter or return types is still a bug.
5. **Verify event-channel cleanup.** For `on*`/subscribe-style channels, confirm the preload returns an unsubscribe function and the main side removes the listener on window close.
6. **Spawn the `integration-qa` agent** (custom type) when the diff spans more than one subsystem or you need a structured finding list. Pass the scoped file list and ask for inline output unless the orchestrator requested file-based handoff to `_workspace/integration_qa_findings.md`.
7. **Route findings** to the owning specialist:
   - Renderer/main contract → `electron-ipc-specialist`
   - Media pipeline progress/cancellation drift → `media-ffmpeg-architect`
   - Downloader drift → `youtube-downloader-specialist`
   - Auth/license shape drift between Electron and Worker → `cloudflare-license-specialist`
8. **Re-verify after the fix lands.** Re-read the same pair of files; do not trust the patch description.

## Checklist

- Every renderer call has a registered handler with matching parameter and return shape.
- Every channel constant in `shared/` is referenced from both sides.
- Event subscriptions return an unsubscribe function and clean up on window destroy.
- Payloads are validated in the main process before filesystem, network, or process actions.
- Cancellation/request ids thread end-to-end through the same channel pair.
- Removed channels are removed from all four layers, not just one.

## Report

Use the agent's structured finding format:

```
[severity] channel-name (file:line)
  layer-A: <what file/line says>
  layer-B: <what other file/line says>
  mismatch: <one sentence>
  fix owner: <specialist agent name>
```

Severity: `blocker` (ships broken UX) → `high` (silent fallback hides bug) → `medium` (type-only drift) → `low` (cosmetic).

End with a one-line summary: total findings, blockers, and whether the diff is safe to merge as-is.
