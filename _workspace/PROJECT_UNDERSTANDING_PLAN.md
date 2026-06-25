# Project Understanding Plan — pre-refactor mapping

**Status:** Phase 1 done. Phase 2 (fan-out) ready to launch. Phase 3 (consolidate) pending.

This document is self-contained — a fresh session can pick up Phase 2/3 by reading only this file plus `HANDOFF.md` and `CLAUDE.md`.

---

## Goal

Produce `_workspace/PROJECT_MAP.md` — a single bounded reference doc the user and future sessions can read instead of re-exploring the codebase before refactor work. Must be accurate enough to ground refactor decisions without re-reading source.

## Why fan-out

Reading every file directly into main context overflows before coverage is complete. Spawning 7 explorer agents in parallel keeps each agent's context scoped to one subsystem; main only sees a final consolidated map.

---

## Phase 1 — DONE

Backbone files already read into main context:
- `CLAUDE.md`, `HANDOFF.md`
- `package.json`, `electron-builder.json5`, `electron.vite.config.ts`, `tsconfig.json`
- `docs/architecture.md`, `docs/requirements.md`, `docs/INDEX.md`, `docs/FEATURES_GUIDE.md`, `ROADMAP.md`, `TROUBLESHOOTING.md`
- `src/router.tsx`, `src/types/ipc.ts`
- `_workspace/orchestrator_report.md` (already present, contains 14 review findings)

Existing `.claude/` already known: 9 specialist agents, 7 workflow skills, plus the 4 we added (orchestrator + integration-qa).

Phase 1 already established:
- Renderer keep-alive router (no unmount on tab switch)
- 16+ IPC namespaces on `window.api`
- Backend organized by domain (music/video/autopilot/youtube/license/security/system/ffmpeg)
- Worker server in `server/` (D1 + KV, JWT v2)
- electron-builder Windows-first, NSIS + portable, GitHub release publisher
- Vite alias `@ → src`

---

## Phase 2 — fan out 7 + 1 explorer agents

**Agent type:** `general-purpose` (needs Write to `_workspace/`; `Explore` is read-only).
**Model:** `opus` for every call.
**Mode:** background, parallel — single message with 8 Agent tool uses.
**Each agent's output destination:** `_workspace/subsystem_<NAME>.md` (the file is the artifact; the agent's return message is just a 5-line summary + word count for sanity check, NOT the full content).

### Universal prompt scaffold (apply to every agent)

```
You are mapping a subsystem of an Electron media tool for a refactor planning doc.
Project root: e:\TOOL DUNG CODE\93-media-tool-mix-nhac
You write your output ONLY to <output_path> using the Write tool.
Your return message is 5 lines max — confirm path, word count, top 3 surprises.

Read the listed paths. Do NOT read node_modules, dist*, docs/archive, docs/history, or files outside the listed scope.
Do NOT paraphrase code line-by-line. Synthesize. Cite file:line for non-obvious claims.
Do NOT propose refactors. Document what is, not what should be.

Output template (use these exact section headers, in this order):

# <Subsystem Name>

## Purpose
One paragraph: what this subsystem does in the product, who calls it.

## Entry points
Bullet list: <file:line> — what the caller passes, what comes back. Cover every public surface (IPC handler registered, exported function used by other subsystems, renderer-facing API).

## Core data flow
Numbered steps: input → transform → output. One flow per major user action. ≤5 flows.

## Key files
Table: file path | one-line role. Include only files essential to understanding; skip helpers obvious from name.

## IPC channels touched
Bullet list of channel string constants (both directions: invoke and event).

## External dependencies
Binaries (ffmpeg/yt-dlp/etc), Node libs, OS calls, network endpoints. Include version constraints if pinned.

## Conventions and invariants
The non-obvious rules: behaviors that look like bugs but are intentional, ordering requirements, "must run on main process", "must be cancellable via X", magic numbers with reasons, etc. This is the most important section — refactor lands here.

## Risks during refactor
Bullet list: what would silently break if someone naively rewrites this. Be specific (file:line). Examples: "audio duration semantics intentional — see CLAUDE.md", "concat list path is platform-sensitive", "this handler must register before window-ready".

## Open questions
Things you noticed that look intentional but you cannot verify without asking the user. Phrase as questions.

Hard limits:
- ≤700 words total
- ≤30 file:line citations
- No code blocks longer than 5 lines
```

### Agent 1 — electron-shell

**Output:** `_workspace/subsystem_electron_shell.md`
**Scope (paths to read):**
- `electron/main.ts`
- `electron/preload.ts`
- `electron/windowManager.ts`
- `electron/authState.ts`
- `electron/autoUpdaterSingleton.ts`
- `electron/handlers/index.ts`
- `electron/handlers/authHandlers.ts`
- `electron/handlers/systemHandlers.ts`
- `electron/handlers/videoHandlers.ts`
- `electron/handlers/videoFinalExportHandlers.ts`
- `electron/handlers/autopilotHandlers.ts` (untracked but present)
- `backend/system/`, `backend/utils/`, `backend/jobQueue/`
**Out of scope:** `electron/youtube/` (covered by agent 5), `electron/handlers/` files dedicated to media ffmpeg internals (agent 2/3 own those bodies; this agent only documents the registration + IPC contract surface).
**Special focus:** lifecycle (window-ready / before-quit / active-export guard), updater singleton pattern, sandbox/contextIsolation invariants, preload's `window.api` namespace structure, dialog whitelist.

### Agent 2 — media-music

**Output:** `_workspace/subsystem_media_music.md`
**Scope:**
- `backend/music/` (every `.ts`)
- `backend/audio/` (whisper modules)
- `backend/ffmpeg/` (config, probe, wrapper)
- `backend/utils/gpuDetection.ts`, `backend/utils/diskSpace.ts`, `backend/utils/cacheCleanup.ts`, `backend/utils/pathUtils.ts`
**Special focus:** `exportAudio.ts` crossfade duration semantics (intentional — see auto-memory), `normalizeAudio.ts` overwrite guard (just fixed, document as invariant), `enhanceAudio/` pipeline order, `playlistEngine.ts` shuffle determinism, music pool LRU.

### Agent 3 — media-video

**Output:** `_workspace/subsystem_media_video.md`
**Scope:**
- `backend/video/` (every `.ts` except `songNhacFfmpegPipe.ts` which is deleted)
- Especially `finalExport.ts` (3000+ lines — this is the heart; spend the most time here)
- `backend/video/canvasExport/` if present
- `shared/videoFinalExportChannels.ts`, `shared/canvasExportTypes.ts`
**Special focus:** finalExport's two-pass vs single-step strategy (line ~2376), pre-transcode shared cache (line ~806), chroma-key forces re-encode (line ~2367 just fixed), GPU/CPU encoder choice plumbing, videoJobManager cancel contract, output verification before declaring success.

### Agent 4 — autopilot

**Output:** `_workspace/subsystem_autopilot.md`
**Scope:**
- `backend/autopilot/` (autopilotRunner.ts, healthCheck.ts, videoPool.ts)
- `electron/handlers/autopilotHandlers.ts`
- `src/pages/AutopilotPage*` and `src/pages/Autopilot/`
- `src/stores/exportActivityStore.ts`
- `tests/unit/backend/autopilotRunner.test.ts`
**Special focus:** day-plan structure, step ordering 1→5, `activeRunToken` lifecycle (just fixed stale-lock — document invariant), `startAutopilotLegacy` is dead 498-line dup (flag in Open questions), heartbeat / STALE_LOCK_TIMEOUT_MS, video pool LRU integration with media-video.

### Agent 5 — youtube-downloader

**Output:** `_workspace/subsystem_youtube.md`
**Scope:**
- `backend/youtube/youtubeDownloader.ts`
- `backend/youtube/cookieManager.ts` (untracked but present)
- `backend/youtube/facebookScraper.ts` (untracked but present)
- `electron/youtube/youtubeHandlers.ts`
- `src/pages/Video/YouTubeDownloaderTab.tsx` and `.css`
**Special focus:** yt-dlp invocation contract (Windows path quoting, args order), cookie file lifecycle (currently plaintext in %TEMP% — flag as known issue), Facebook scraper not in `activeProcesses` (known cancel gap), retry backoff signal handling (known cancel gap), batch progress mapping to job ids.

### Agent 6 — license-auth-server

**Output:** `_workspace/subsystem_license_auth.md`
**Scope:**
- `backend/license/` (every `.ts`)
- `backend/security/` (antiDebug, apiSigning, rateLimiter, securityMonitoring, stringEncryption, tamperDetection, environmentDetection, licenseCheck)
- `backend/licenseServerConfig.ts`
- `electron/handlers/authHandlers.ts`
- `server/` (every `.ts` and `.toml`, including `server/handlers/`, `server/dashboard/`, `server/migrations/`)
- `shared/licenseTypes.ts`, `shared/licenseUtils.ts`, `shared/passwordValidator.ts`
**Special focus:** auth state machine (5 states), JWT v2 + refresh token flow, machine-id binding + allow-rebind, version policy contract Electron↔Worker (just fixed DEFAULT_POLICY_VERSION 4.4.0 — document invariant), HMAC request signing, fail-open vs fail-closed at every boundary.

### Agent 7 — react-renderer

**Output:** `_workspace/subsystem_react_renderer.md`
**Scope:**
- `src/App.tsx`, `src/AppLayout.tsx`
- `src/components/` (Sidebar, ErrorBoundary, TopBarStats, VersionBlockingScreen, etc.)
- `src/pages/` (every page except already-covered Autopilot)
- `src/features/` (post-song-nhac-removal — only what's left)
- `src/stores/` (every store)
- `src/config/featureFlags.ts`
- `src/router.tsx` (re-confirm)
**Special focus:** keep-alive router pattern (lazy mount + display:none), `useEffect` cleanup on long-running IPC subscribers, error boundary placement, Zustand store coupling, banners (offline / blocked / disk-error), TopBar 1s + 30s polling cadence.

### Agent 8 — consolidator

Spawn AFTER agents 1–7 finish (use SendMessage notifications to know).
**Type:** `general-purpose`, model `opus`.
**Output:** `_workspace/PROJECT_MAP.md`
**Scope:** read all 7 `_workspace/subsystem_*.md` files, plus `_workspace/PROJECT_UNDERSTANDING_PLAN.md` (this file), plus `_workspace/orchestrator_report.md`.
**Prompt:**

```
You are consolidating 7 subsystem maps into one PROJECT_MAP.md the user and future sessions read before refactor.

Read these files:
- _workspace/PROJECT_UNDERSTANDING_PLAN.md
- _workspace/orchestrator_report.md
- _workspace/subsystem_electron_shell.md
- _workspace/subsystem_media_music.md
- _workspace/subsystem_media_video.md
- _workspace/subsystem_autopilot.md
- _workspace/subsystem_youtube.md
- _workspace/subsystem_license_auth.md
- _workspace/subsystem_react_renderer.md

Write _workspace/PROJECT_MAP.md with sections:

# 93 Media Tool — Project Map

## Top-level architecture
2 paragraphs. Renderer ↔ Preload ↔ Main ↔ Backend services ↔ External tools ↔ Cloudflare Worker. State the actual coupling, not the docs version.

## Subsystems
For each of the 7: 1 paragraph purpose + entry points (≤5) + 3 most important invariants. Link to subsystem_*.md for detail. ≤200 words each.

## Cross-cutting concerns
- IPC contract surface (preload ↔ ipc.ts ↔ handlers ↔ shared/*Channels.ts)
- Cancellation contract (every long-running job)
- Active-export guard (updater + auth teardown)
- Secrets boundary (Worker env / main process / never renderer)
- Windows path safety
- GPU/CPU encoder choice plumbing

## Refactor risk register
Aggregate the "Risks during refactor" sections from all 7 maps. Group by severity (could-silently-break / would-be-noticed / cosmetic).

## Open questions to resolve before refactor
Aggregate the "Open questions" sections. Numbered list. The user reads this and answers; their answers shape the refactor plan.

## Outstanding HIGH findings (deferred)
Carry forward the 9 deferred items from orchestrator_report.md so they don't get lost.

Hard limits:
- ≤2500 words total
- Use markdown links [path](path) and path:line format for citations
- Do NOT propose refactor steps — that comes later, only document the territory
```

---

## Phase 3 — DONE when

- `_workspace/PROJECT_MAP.md` exists
- All 7 `_workspace/subsystem_*.md` exist
- HANDOFF.md has an entry pointing to PROJECT_MAP.md
- Main context did not exceed budget — i.e., main never read the 7 subsystem files directly, only PROJECT_MAP.md

---

## Conventions to remind every agent

These are reinforced by `CLAUDE.md` and auto-memory; the agent prompt should NOT relax them:

- Audio export duration semantics are intentional — never propose changing them.
- No AI/LLM runtime in the product — agents and skills are dev-only harness, never recommend integrating inference, model loading, or LLM calls into the app runtime.
- Secrets stay in Worker env or Electron main process; never in the renderer bundle.
- Windows path safety, packaged-build compatibility, and active-export teardown guards are mandatory review lenses.

---

## Resume instructions for a fresh session

1. Read `CLAUDE.md` (project pointer + conventions).
2. Read `HANDOFF.md` (what's done, what's next).
3. Read this file (`_workspace/PROJECT_UNDERSTANDING_PLAN.md`).
4. Check which `_workspace/subsystem_*.md` already exist:
   - If 0/7 exist → spawn agents 1–7 in parallel (single message, 7 Agent tool uses), each with the universal scaffold + that agent's scope block above.
   - If some exist → spawn only the missing ones.
   - If all 7 exist but no `PROJECT_MAP.md` → spawn agent 8 (consolidator).
5. After PROJECT_MAP.md is written, append HANDOFF.md entry and report to user.

Do NOT redo Phase 1 — main context already has the backbone, and the agents read source directly so they don't need it pre-loaded.
