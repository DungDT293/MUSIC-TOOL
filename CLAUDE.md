# CLAUDE.md

Project: 93-media-tool-mix-nhac — Electron + React + TypeScript desktop media tool (FFmpeg video/audio export, autopilot orchestration, YouTube downloader, Cloudflare Worker license/auth).

## Harness: Electron Media Tool

**Goal:** Route changes touching FFmpeg, IPC, autopilot, YouTube downloader, license/auth, or release packaging through specialist agents and verify cross-layer contracts before merging.

**Triggers:**
- Cross-cutting changes (touch 2+ subsystems): use `harness-orchestrator` skill.
- Single-domain changes: existing workflow skills auto-trigger
  - FFmpeg/audio/video export → `media-export-change` or `ffmpeg-regression-review`
  - Electron IPC / preload / channel contracts → `electron-ipc-change`
  - Autopilot day-plan / orchestration → `autopilot-change`
  - YouTube / yt-dlp / cookies → `youtube-downloader-change`
  - License, auth, JWT, version policy, Worker server → `license-auth-change`
  - Build, packaging, updater, server deploy → `release-safety-check`
- IPC-shape integrity (preload ↔ `src/types/ipc.ts` ↔ handler registration ↔ `shared/`): use `integration-qa` skill.
- Explicit scoped implementation/fix requests: use `minimal-change-apply`; domain workflows above still apply for sensitive subsystems.
- Multi-document repository or upstream documentation research: use `repository-docs-research`.

`harness-orchestrator` remains review-only; do not place the code-writing agent in its review fan-out. `repository-docs-reader` is read-only and never edits code or documentation.

Simple questions or single-file edits unrelated to the above can be answered directly.

**Specialists** live in `.claude/agents/` — invoke via Agent tool with `model: "opus"`. **Skills** live in `.claude/skills/`.

**Conventions enforced by harness:**
- Audio export duration semantics are intentional — do not change unless explicitly requested.
- No AI/LLM runtime in the product. Agents and skills are dev-only harness.
- Secrets stay in Worker env or Electron main process; never in the renderer bundle.
- Windows path safety, packaged-build compatibility, and active-export teardown guards are mandatory review lenses.
- **UI/UX Rule (BẮT BUỘC): TUYỆT ĐỐI KHÔNG TỰ Ý THÊM ICON / EMOJI VÀO GIAO DIỆN (UI).**
  - Nghiêm cấm tự tiện chèn emoji (như 🎵, 📁, ✏️, 🛡️, 🔍, 📊, 🎲, 🧪,...) hoặc biểu tượng trang trí vào text, tiêu đề, nhãn, nút bấm, bảng danh sách hay thẻ giao diện.
  - Chỉ sử dụng icon khi người dùng yêu cầu cụ thể.
  - Giao diện phải luôn sạch sẽ, chuyên nghiệp, tối giản, sử dụng nhãn text rõ nghĩa thay vì icon màu mè.

**HANDOFF rule (project-wide):**
After every feature update, fix, refactor, or notable change, append an entry to [HANDOFF.md](HANDOFF.md). One entry per change with: date, what changed, files touched, why, and any follow-up needed. This is the source of truth for cross-session continuity — new sessions read HANDOFF.md first to know what was done and what's pending.

**Change log:**

| Date | Change | Target | Reason |
|------|--------|--------|--------|
| 2026-07-11 | Added minimal code applier + read-only repository docs reader and routing skills | `.claude/agents/minimal-change-applier.md`, `.claude/agents/repository-docs-reader.md`, `.claude/skills/minimal-change-apply/`, `.claude/skills/repository-docs-research/`, `CLAUDE.md` | Add safe implementation and cited documentation workflows without changing review-only orchestration |
| 2026-06-13 | Added orchestrator skill + integration-qa agent/skill + this pointer | `.claude/skills/harness-orchestrator/`, `.claude/agents/integration-qa.md`, `.claude/skills/integration-qa/`, `CLAUDE.md` | Route cross-cutting changes; close IPC contract-drift gap |
