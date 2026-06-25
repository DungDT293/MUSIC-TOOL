---
name: harness-orchestrator
description: Route cross-cutting changes through the right specialists for this Electron media tool. Trigger when a change, PR, or review request touches two or more of these subsystems at once — FFmpeg / media export, Electron IPC / preload, autopilot orchestration, YouTube downloader, license/auth/Worker server, build/packaging/updater. Also trigger for "review my changes", "review this PR", "check this diff", "is this safe to ship", "rerun the harness", "update the harness review", or when the user asks for end-to-end verification across layers. Single-domain edits should use the matching workflow skill directly (media-export-change, electron-ipc-change, autopilot-change, youtube-downloader-change, license-auth-change, release-safety-check), not this orchestrator.
---

# Harness Orchestrator

Coordinate the specialist agents and workflow skills for cross-cutting changes in this repository. The orchestrator decides **who reviews what**, in what order, and aggregates findings into a single mergeability verdict. It does not perform line-level review itself — it delegates to specialists.

## When this skill runs

A change qualifies as cross-cutting when **two or more** of the following are true:

- Touches `backend/music/` or `backend/video/` or `backend/ffmpeg/` (media pipeline).
- Touches `electron/handlers/`, `electron/preload.ts`, `src/types/ipc.ts`, or `shared/*Channels.ts` (IPC contract).
- Touches `backend/autopilot/` or `src/pages/Autopilot*` (autopilot orchestration).
- Touches `backend/youtube/` or `electron/youtube/` (downloader).
- Touches `server/`, `backend/license/`, `electron/authState.ts`, or `electron/handlers/authHandlers.ts` (license/auth).
- Touches `package.json` scripts, `electron-builder.json5`, `electron.vite.config.*`, `electron/autoUpdaterSingleton.ts`, or `.env.production.example` (build/release).

Single-domain changes should call the matching workflow skill directly.

## Execution mode

**Sub-agent mode by default.** Specialists in this repo do read-only review and return findings; team-mode communication overhead is not worth it for the typical 1–4 specialist call. Use `Agent` tool calls with `model: "opus"` and `run_in_background: true` for parallel review when domains are independent.

**Switch to team mode** only when the user explicitly asks for "team review" or when specialists need to debate a contested fix (rare). In that case, `TeamCreate` a team containing only the specialists relevant to the diff plus `integration-qa`, then `TaskCreate` per subsystem.

## Workflow

### Phase 0 — Context check

1. Read recent context: `git status` (already in the system message) and `git diff --stat` to confirm the changed file set.
2. Check for `_workspace/` from a prior orchestrator run. If present and the user asked for "rerun" or "update": move it to `_workspace_prev/` and start fresh. If the user asked for "fix the X finding from last time": read `_workspace/orchestrator_report.md` and route only that finding's owner.
3. If no `_workspace/` and no prior context, this is a fresh run.

### Phase 1 — Scope routing

Map each changed file to its owning specialist. Use this table:

| Path pattern | Owning specialist | Workflow skill |
|---|---|---|
| `backend/music/**`, `backend/video/**`, `backend/ffmpeg/**` | `media-ffmpeg-architect` | `media-export-change` / `ffmpeg-regression-review` |
| `electron/handlers/**`, `electron/preload.ts`, `src/types/ipc.ts`, `shared/*Channels.ts` | `electron-ipc-specialist` + `integration-qa` | `electron-ipc-change` |
| `backend/autopilot/**`, `src/pages/Autopilot*` | `autopilot-workflow-specialist` | `autopilot-change` |
| `backend/youtube/**`, `electron/youtube/**` | `youtube-downloader-specialist` | `youtube-downloader-change` |
| `server/**`, `backend/license/**`, `electron/authState.ts`, `electron/handlers/authHandlers.ts` | `cloudflare-license-specialist` | `license-auth-change` |
| `package.json`, `electron-builder.json5`, `electron.vite.config.*`, `electron/autoUpdaterSingleton.ts`, `.env.production*` | `build-release-specialist` | `release-safety-check` |
| `src/App.tsx`, `src/AppLayout.tsx`, `src/components/**`, `src/pages/**` (non-autopilot), `src/features/**`, `src/stores/**` | `react-ui-specialist` | (no dedicated skill — direct review) |
| Anything touching auth/license enforcement, secret handling, file deletes, IPC exposure | also `security-hardening-reviewer` | (cross-cuts other skills) |

If the diff touches IPC layers, **always** add `integration-qa` to the routing list. IPC contract drift is the highest-risk class of bug for this app.

### Phase 2 — Parallel specialist review

Spawn the routed specialists in parallel. For each:

```
Agent(
  subagent_type: "<specialist-name>",
  model: "opus",
  run_in_background: true,
  prompt: "<scoped diff summary> + <files in your domain> + 'Use your review checklist. Return: severity-tagged findings (blocker/high/medium/low), each with file:line, root cause, suggested fix, and verification step. Do not edit files — review only.'"
)
```

Hold the parallel set; do not start Phase 3 until all return.

### Phase 3 — Integration QA pass

If the diff touched IPC layers OR multiple specialists' domains, run the `integration-qa` skill with the full changed-file list. This catches contract drift that no single-domain specialist would notice.

### Phase 4 — Aggregate verdict

Write `_workspace/orchestrator_report.md` with:

1. **Summary line:** total findings, blockers, mergeability verdict (`safe to merge` / `merge after fixes` / `block`).
2. **Per-specialist sections:** each specialist's findings verbatim, grouped by severity.
3. **Cross-cutting issues:** anything `integration-qa` flagged that spans multiple specialists.
4. **Recommended next actions:** ordered list of fixes with the owning specialist, so the user knows who to hand each item to.
5. **Verification commands:** the union of `npm run build`, `npx tsc --noEmit`, `npm run lint`, and any specialist-suggested smoke checks.

### Phase 5 — Hand-off

Report to the user inline with the summary section and a pointer to `_workspace/orchestrator_report.md` for the full detail. If any blocker exists, do not suggest commands that ship the diff (no push, no build:app) until those are addressed.

## Error handling

- A specialist agent times out or returns empty → record it as `unverified: <domain>` in the report, suggest manual review, and continue. Do not retry more than once.
- Two specialists disagree on a finding → quote both, leave the resolution to the user; do not auto-resolve.
- Diff is too large for one pass → split by subsystem in the routing table, run subsystems sequentially with their own `_workspace/orchestrator_report_<subsystem>.md`, then write a top-level summary.
- A finding's fix would touch a layer outside the diff (e.g. fixing an IPC handler also requires a preload edit) → flag as `cross-layer fix required` so the user knows the patch spans more files than the original change.

## Conventions reinforced

These are mandatory review lenses for every run; remind specialists in the prompt if relevant:

- Audio export duration semantics are intentional. Do not propose changes to duration logic without explicit user request.
- No AI/LLM runtime in the product. Reject any specialist suggestion that adds inference, model loading, or LLM calls to the app runtime.
- Secrets stay in Worker env or Electron main process. Never in the renderer bundle, never in logs.
- Windows path safety, packaged-build compatibility, and active-export teardown guards are mandatory for any media or release change.
- File deletions must be constrained to user-selected roots.

## Test scenarios

**Normal flow — multi-subsystem PR:**

User: "Review my changes, the diff touches autopilot runner and final video export."
1. Phase 0: read git diff, no prior workspace.
2. Phase 1: route to `autopilot-workflow-specialist` + `media-ffmpeg-architect` + `integration-qa` (because final export changes likely touch IPC progress events).
3. Phase 2: spawn three specialists in parallel.
4. Phase 3: integration-qa pass on changed files.
5. Phase 4: aggregate, write report. Suggest `npm run build` + `npx tsc --noEmit` + targeted Vitest.
6. Phase 5: inline summary, pointer to full report.

**Error flow — IPC-only change:**

User: "Check this preload + ipc types diff."
1. Phase 0: confirm only IPC layers touched.
2. Phase 1: this is single-domain — recommend the user invoke `electron-ipc-change` skill directly. Only run the orchestrator if they explicitly want full integration QA on top.
3. If they continue: route to `electron-ipc-specialist` + `integration-qa`, skip media/autopilot/etc.

**Re-run flow:**

User: "Rerun the harness on the latest diff."
1. Phase 0: detect existing `_workspace/`, move to `_workspace_prev/`.
2. Phases 1–5 fresh.
3. Phase 4 report includes a "Changes since last run" section diffing against `_workspace_prev/orchestrator_report.md`.

## Output style

Concise. Show the user the summary line and verdict first; the full per-specialist findings live in the report file. Reference files with `[path](path)` markdown links and `path:line` for specific issues. Do not narrate the orchestration steps — the user cares about findings, not process.
