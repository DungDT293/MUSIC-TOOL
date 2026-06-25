# License / Auth / Server

## Purpose
End-to-end machine-bound license + account auth subsystem. Electron client derives a stable hardware hash, signs every request with HMAC-SHA256, and round-trips a Cloudflare Worker (D1-backed) to register, validate keys, exchange JWT v2 device tokens, and gate the app against a server-driven version policy. Renderer never holds secrets — main process owns all crypto, ticket storage, and IPC surfaces.

## Entry points
- `electron/handlers/authHandlers.ts:59` — registers all `auth:*`, `license:*`, `app:*`, `policy:get` IPC; called from `electron/handlers/index.ts` at app startup.
- `electron/authState.ts:190` `getOrInitAuthState` — singleton that hydrates from `.enc` ticket store on first `auth:getState` call.
- `backend/license/onlineLicenseService.ts:105` `submitLicenseRequest` / `:244` `evaluateLicenseState` — the only outbound license endpoints touched by main.
- `server/index.ts:27` — Worker `fetch` router; gates every non-public route behind HMAC verify (`server/index.ts:41`) before dispatch.
- `server/auth-v2-handlers.ts` — V2 endpoints (check-status, validate-key, validate-token, refresh-token, login, admin unlock/revoke/allow-rebind).
- `server/handlers/check.ts` / `register.ts` / `admin-update.ts` / `version-policy.ts` — V1 + version-policy entry points.
- `server/dashboard/serve.ts:6` — inline HTML admin SPA at `/dashboard` and `/`.

## Core data flow
1. **Register**: renderer → `auth:register` → `postJson('/api/auth/register')` (HMAC-signed via `apiSigning.ts:205`) → Worker `handleRegister` inserts row with `key_status='PENDING'`, auto-generates `key_kich_hoat` UUID but does NOT return it; client sees `pending`.
2. **Admin approve**: dashboard → `/api/admin/users/:id/update` → sets `trang_thai='CHO_PHEP'`, `key_status='ACTIVE'`, returns `key_kich_hoat` for admin to copy/share out-of-band.
3. **Activate**: client `auth:validateKey` → `/api/auth/validate-key` → on match generates JWT device token (30d) + opaque refresh token (90d), persists into `registrations` row, returns both. Client writes them via `writeEncryptedAuthState` (`electron/authState.ts:276`).
4. **Startup validation**: `auth:validateToken` → `/api/auth/validate-token` → JWT signature+exp check (`server/utils/jwt.ts:124`), then DB row check that token still equals `device_token`, account is `CHO_PHEP`, key not REVOKED/LOCKED, license_expires_at not crossed.
5. **License heartbeat (legacy)**: `evaluateLicenseState` reads ticket → if <5s old returns cached `ok` (`backend/license/onlineLicenseService.ts:272`); else hits `/api/licenses/check` and falls back to `offline` for ≤24h with clock-rollback detection.

## Key files
| File | Role |
|------|------|
| `backend/license/onlineLicenseService.ts` | Legacy ticket flow: register/poll/check, offline grace, INSTALLER_KEY guard. |
| `backend/license/machineId.ts` | Hardware ID derivation (wmic→PowerShell CIM fallback, virtual-MAC filter, %APPDATA% + ProgramData cache). |
| `backend/license/ticketStore.ts` | Plaintext `licenseTicket.json` in ProgramData. |
| `backend/security/apiSigning.ts` | Client HMAC sign + verify (PBKDF2 from machineId, 5min skew, in-memory nonce cache). |
| `backend/security/stringEncryption.ts` | AES-256-CBC obfuscation of public URLs (NOT secrets). |
| `backend/security/securityMonitoring.ts` | Outbound `/api/security/report` events with rate-limit per machine+type. |
| `backend/security/tamperDetection.ts` | Reads `build-hash.json` next to main.js, fail-closed on hash check. |
| `backend/security/antiDebug.ts` | Uses Electron `app.isPackaged` (FIX M8) instead of NODE_ENV. |
| `backend/licenseServerConfig.ts` | URL resolution: `LICENSE_SERVER_BASE` / `AUTH_BASE` env, falls back to `LEGACY_LICENSE_SERVER_BASE` constant. |
| `electron/authState.ts` | 5-state machine, mutex-serialized writes (FIX H6), encrypted-store hydration. |
| `electron/handlers/authHandlers.ts` | All client IPC; `policy:get` fetches Worker policy with 10s timeout + local fallback. |
| `server/index.ts` | Worker router + signature gate. |
| `server/security-verification.ts` | Server HMAC verify with D1 + in-memory nonce fallback (FIX H3). |
| `server/auth-v2-handlers.ts` | V2 JWT flow, machine-rebind logic, tamper bookkeeping (now monitor-only). |
| `server/handlers/check.ts` | V1 login: password before tracking, multi-machine alert at >1, hard reject machine mismatch. |
| `server/handlers/version-policy.ts` | Public GET, schema-validated, fail-open to `DEFAULT_VERSION_POLICY`. |
| `server/admin-auth.ts` | Owner-bootstrap from `OWNER_EMAIL`/`OWNER_PASSWORD_HASH`, admin sessions table. |
| `server/auto-block.ts` | Threshold rules — degraded to `action: 'warn'` only, never blocks. |
| `server/env.ts:26` | `DEFAULT_POLICY_VERSION = '4.4.0'` invariant. |
| `server/migrations/001_auth_flow_v2.sql` | Adds `key_status`, tokens, `auth_audit_logs` (column DDL commented; app handles gracefully). |
| `shared/licenseTypes.ts` / `licenseUtils.ts` / `passwordValidator.ts` | Pure types + zxcvbn-style strength rules (renderer-safe). |

## IPC channels touched
Electron (main↔renderer): `license:getState`, `license:register`, `license:retry`, `license:clear`, `auth:getState`, `auth:register`, `auth:login`, `auth:refresh`, `auth:clear`, `auth:checkStatus`, `auth:validateKey`, `auth:validateToken`, `app:getVersion`, `app:setExportActive`, `app:checkUpdate`, `app:downloadUpdate`, `app:installUpdate`, `app:getUpdateChannel`, `app:setUpdateChannel`, `app:getGpuFfmpegProfile`, `app:setGpuFfmpegProfile`, `app:getLegacyGpuFfmpegPath`, `app:setLegacyGpuFfmpegPath`, `policy:get`.

Worker HTTP: `POST /api/licenses/register|poll|check`, `POST /api/auth/register|check|login|check-status|validate-key|validate-token|refresh-token`, `POST /api/auth/admin/update|unlock-key|revoke-key|allow-rebind`, `GET /api/version-policy`, `POST /api/admin/version-policy/update`, `POST /api/security/report`, `POST /api/video/export`, `POST /api/migrate/v2`, `GET|POST /api/admin/*` (dashboard), `GET /dashboard|/`.

## External dependencies
- Cloudflare D1 binding `DB` (database `license-db`, id `93f5890b-...` in `server/wrangler.toml:20`). Tables: `registrations`, `auth_audit_logs`, `admin_accounts`, `admin_sessions`, `version_policy`, `security_events`, `machine_id_tracking`, `used_nonces`, `video_exports`, `admin_activity_log`. No KV, Vectorize, or Workers AI bindings.
- Worker secrets: `INSTALLER_SECRET`, `ADMIN_TOKEN`, `JWT_SECRET`, `OWNER_EMAIL`, `OWNER_PASSWORD_HASH`, `SENDGRID_API_KEY`, `ALERT_EMAIL`, `WEBHOOK_URL`.
- Electron env: `LICENSE_SERVER_BASE`, `AUTH_BASE`, `LICENSE_INSTALLER_KEY`, `LICENSE_INSTALLER_SECRET`. Dev-only overrides: `MACHINE_ID_FILE`, `LICENSE_TICKET_PATH` gated by `NODE_ENV==='development'`.
- Node libs: `node:crypto` (HMAC, PBKDF2, AES-256-CBC), `electron.app/ipcMain/net`, `node:child_process` (wmic/PowerShell/reg), `os.networkInterfaces`. Worker uses Web Crypto only.
- Outbound: `https://license-server.dungdong333.workers.dev` (legacy default), `https://admin93media.xyz` (planned), GitHub releases via `electron-updater`, optional SendGrid + Discord/Slack webhooks.

## Conventions and invariants
- **DEFAULT_POLICY_VERSION = '4.4.0'** (`server/env.ts:26`) — must equal current `package.json` version on every release; `policy:get` falls open to this when DB row missing/corrupt (`server/handlers/version-policy.ts:30,55,73`).
- **Fail-OPEN points**: `policy:get` returns local app version on Worker timeout (`electron/handlers/authHandlers.ts:777`); `handleVersionPolicy` returns `DEFAULT_VERSION_POLICY` on any DB error; `auth:refresh` on network error keeps `allowed` state instead of demoting (`authHandlers.ts:339`); legacy `auto-block.ts:124` only warns, never enforces; `evaluateLicenseState` allows 24h offline grace.
- **Fail-CLOSED points**: missing `LICENSE_INSTALLER_KEY` becomes sentinel `__MISSING_INSTALLER_KEY__` (`onlineLicenseService.ts:29`) so server always rejects rather than empty-string passing; tamper hash mismatch returns `false` (`tamperDetection.ts:91`); HMAC length-mismatch logs + rejects before `timingSafeEqual` (`apiSigning.ts:163`, FIX H7/M22); nonce reuse always enforced via D1 or in-memory fallback (FIX H3, `server/security-verification.ts:134-162`); clock rollback denies offline grace (`onlineLicenseService.ts:316`, FIX M25).
- **5 LicenseStatus states**: `checking | needsRegistration | pending | ok | offline | denied` (`onlineLicenseService.ts:38`). InternalAuthStatus is a separate enum: `unregistered | pending | allowed | blocked | error` (`authState.ts:140`).
- **Machine binding**: V1 `handleCheck` rejects mismatch outright after password verify (`server/handlers/check.ts:164`). V2 endpoints have a `RELOGIN_REQUIRED` action and a still-present-but-disabled `if (false && ...)` tamper-block path (`auth-v2-handlers.ts:488,701,916,1112`) — dead code preserved for re-enable.
- **Rebind** (`handleAllowRebind`, `:1341`): admin-only; one atomic UPDATE clears both tokens and `machine_id_tracking` to suppress false-positive MULTIPLE_MACHINE_IDS.
- **HMAC signing key** = PBKDF2(machineId, salt='93MediaToolMixNhac2025APISigningSalt!', 10000, SHA-256) — same salt+iterations on both sides; tied to machine, no shared secret needed.
- **Auto-rebind**: server-side `autoRebindMachineId` (`auth-v2-handlers.ts:142`) defined but only called via `findRegistrationForValidateKey` UUID-aware key matcher (`:208`); not invoked by current handlers.
- **Audit log table is best-effort**: every `writeAuditLog` swallows errors (`auth-v2-handlers.ts:136`) so missing migration can't break auth.
- **Admin auth dual-path**: legacy `ADMIN_TOKEN` env constant OR session token from `admin_sessions` (`server/admin-auth.ts:120`). Legacy path returns synthetic session id `legacy-admin-token`.
- **`isPasswordHashed` checks fixed length 69 chars** (44 + ':' + 24) — plaintext fallback verifies legacy rows that haven't been migrated.
- **Renderer-safety**: `passwordValidator.ts` lives in `shared/` because importing it from `backend/` crashed packaged renderer (SEC-02 note in file header).

## Risks during refactor
- `auth-v2-handlers.ts:488,701,916,1112` — `if (false && machineIdChange)` dead branches; deleting them removes monitor-only tamper bookkeeping that callers may resurrect.
- `server/env.ts:26` — bumping `DEFAULT_POLICY_VERSION` without DB upsert silently downgrades clients on any policy fetch error; coupled to release process.
- `electron/handlers/authHandlers.ts:46-57` — `refreshLicenseState` overwrites `licenseState.machineHash` with old value on failure; refactor must preserve identity continuity for retry UX.
- `backend/license/onlineLicenseService.ts:33-34` — `API_BASE` and `INSTALLER_KEY` are module-scope frozen at import; switching to runtime config requires breaking this.
- `backend/security/apiSigning.ts:15` — `usedNonces` is process-local; if main process restarts mid-session, nonce dedup state is lost (server still enforces).
- `electron/authState.ts:155-188` — `setAuthState` is fire-and-forget; consumers reading `authState` synchronously can race the mutex chain. Use `setAuthStateAsync` in new code.
- `server/handlers/check.ts:150` — V1 multi-machine threshold (>5) is monitor-only comment, no enforcement; refactoring auto-block must not assume V1 contributes.
- `backend/security/stringEncryption.ts:11` — encryption key derived from a constant in source; treat as obfuscation only, never as secret store.
- `backend/license/machineId.ts:142-151` — virtual-MAC filter discards any locally-administered MAC (bit `0x02`), which can drop legitimate adapters on some laptops. Cache file at `%APPDATA%\93MediaToolMixNhac\machine-id.txt` masks instability after first run.
- `server/security-verification.ts:25` — in-memory nonce cap 50k per Worker isolate; under burst load older nonces evict and replay-window relies on 5-min timestamp gate.

## Open questions
- Should the disabled `if (false && ...)` tamper-block paths in `auth-v2-handlers.ts` be removed, or is re-enable planned?
- Is `auto-rebind` (`autoRebindMachineId`) intended to fire automatically on key match across machines, or remain admin-gated via `handleAllowRebind`?
- `auth:refresh` keeps `allowed` on network error indefinitely — should there be a max consecutive-failure window before forcing re-validation?
- `policy:get` returns app's own version as fallback — is that intentional (always-allow) or should it cache the last successful policy fetch?
- `LEGACY_LICENSE_SERVER_BASE` and `PLANNED_LICENSE_SERVER_BASE` both exist (`backend/licenseServerConfig.ts:1-2`); is the migration to `admin93media.xyz` blocked solely on Cloudflare API token routes (per `wrangler.toml:11`)?
- V1 `/api/auth/check` and V2 `/api/auth/login` both accept the same payload shape — is V1 deprecated or still receiving traffic from older clients?
