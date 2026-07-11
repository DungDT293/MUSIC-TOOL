---
name: minimal-change-apply
description: Route explicit, scoped repository implementation requests to the minimal-change-applier. Trigger whenever the user clearly asks to implement, fix, add, remove, or apply code with concrete expected behavior, including applying an approved finding and adding a focused test. Do not trigger for review-only requests, planning, diagnosis without permission to edit, documentation research, broad refactors, commit/push-only requests, or unresolved product decisions; use the matching domain workflow first for FFmpeg, IPC, autopilot, downloader, auth, or release changes.
---

# Minimal Change Apply

Apply a concrete code request with the smallest safe diff, targeted verification, specialist re-review, and a truthful `HANDOFF.md` entry.

## Entry gate

Run only when the user explicitly asks for a repository change and expected behavior is concrete. If requirements or destructive consequences remain undecided, clarify before spawning the writer.

Do not use this workflow for review, audit, planning, explanation, general research, open-ended cleanup, or git/release operations alone.

## Phase 0 — Preflight

1. Read `CLAUDE.md` and relevant recent `HANDOFF.md` entries.
2. Capture current changed-file list and relevant diffs. Preserve all unrelated user changes.
3. Define:
   - Acceptance criteria.
   - Allowed paths.
   - Invariants to preserve.
   - Targeted verification.
4. If a target file contains unrelated edits that overlap the requested hunk, stop and report the conflict.

## Phase 1 — Domain routing

Apply existing workflow constraints before editing:

| Scope | Required workflow | Post-change owner |
|---|---|---|
| FFmpeg, audio/video export, normalization, progress/cancel | `media-export-change`; add `ffmpeg-regression-review` for command/duration/mux/retry/cleanup changes | `media-ffmpeg-architect` |
| Electron handler, preload, renderer IPC types, channels | `electron-ipc-change` | `electron-ipc-specialist` + `integration-qa` |
| Autopilot day plan, sequencing, recovery | `autopilot-change` | `autopilot-workflow-specialist` |
| YouTube, yt-dlp, cookies | `youtube-downloader-change` | `youtube-downloader-specialist` |
| License, auth, JWT, Worker policy | `license-auth-change` | `cloudflare-license-specialist` + security review |
| Build, packaging, updater, deployment | `release-safety-check` | `build-release-specialist` + security review |
| Other focused UI/backend code | repository conventions | matching direct specialist when available |

Two or more subsystems require `harness-orchestrator` after the patch. The orchestrator remains review-only.

## Phase 2 — Apply

Invoke:

```text
Agent(
  subagent_type: "minimal-change-applier",
  model: "opus",
  run_in_background: false,
  prompt: <original request + acceptance criteria + allowed paths + preserved behavior + dirty-file snapshot + domain checklist + targeted verification>
)
```

The agent may edit only allowed paths. Scope expansion requires an explicit stop and explanation. Never place this writer in the orchestrator's parallel review set.

## Phase 3 — Verify and re-review

1. Run the narrowest test or deterministic smoke check that exercises changed behavior.
2. Re-run the owning specialist's checklist.
3. Always run `integration-qa` after IPC/preload/channel/type changes.
4. Run `harness-orchestrator` for changes spanning two or more subsystems.
5. Block completion on unresolved blocker/high findings. Report pre-existing or out-of-scope failures exactly.

## Phase 4 — Finalize

Confirm `HANDOFF.md` was updated only after a real change. Entry must be newest-first and include actual verification outcomes. Do not commit, push, release, publish, install dependencies, or delete unrelated files.

## Trigger matrix

### Should trigger

- "Sửa lỗi input số này, giữ behavior hiện tại và thêm test."
- "Triển khai thay đổi đã mô tả bằng diff nhỏ nhất."
- "Apply blocker H-03 trong report."
- "Fix đúng lỗi preload này, không refactor phần khác."
- "Thêm validation cho payload và chạy test liên quan."
- "Sửa bug FFmpeg này rồi kiểm cancellation."
- "Thực hiện code theo acceptance criteria sau."
- "Áp dụng finding đã review và cập nhật HANDOFF."

### Should not trigger

- "Review diff này." → review workflow or `harness-orchestrator`.
- "Lập kế hoạch sửa lỗi." → planning.
- "Lỗi FFmpeg có thể do đâu?" → diagnosis/domain workflow.
- "Add IPC dialog" with unresolved contract → clarify/use `electron-ipc-change` first.
- "Refactor toàn backend cho sạch." → scope too broad.
- "Tóm tắt ROADMAP và HANDOFF." → `repository-docs-research`.
- "Update README wording." → documentation authoring, not code applier.
- "Commit/push thay đổi hiện tại." → explicit git operation.

## Test scenarios

**Normal — scoped single domain:**
A media bug has concrete expected output. Route `media-export-change`, snapshot dirty files, invoke writer with allowed paths, run focused test, re-review with media specialist, then update HANDOFF.

**Error — dirty overlap:**
Target hunk already contains unrelated user edits. Return `blocked` with file/hunk; do not overwrite, reset, or stash.

**Error — verification outside scope:**
Targeted test fails for a pre-existing dependency or unrelated module. Report command and evidence; do not broaden patch silently.

**Re-run — approved follow-up:**
Read current diff and previous verification, pass only unresolved acceptance criteria to the same agent role, rerun affected check, and add one HANDOFF entry for the completed change rather than one per attempt.

## Output

Return status first, then changed files, preserved behavior, verification outcomes, specialist results, HANDOFF status, and remaining follow-up.
