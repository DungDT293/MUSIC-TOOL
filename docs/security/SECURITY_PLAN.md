# Kế Hoạch & Trạng Thái Bảo Mật — 93 Media Tool v4.0.2

> Cập nhật lần cuối: **2026-04-02**
> Phiên bản tài liệu: 2.0

---

## Implementation Status (2026-04-02)

| Security Control | Status | Notes |
|-----------------|--------|-------|
| AES-256-GCM encrypted auth state | ✅ DONE | `backend/auth/encryptedAuthStore.ts` |
| PBKDF2 key derivation | ✅ DONE | **300,000 iterations** (NIST 2023 compliant) |
| Machine-ID binding | ✅ DONE | SHA-256 of hardware identifiers, mismatch → null |
| HMAC integrity check | ✅ DONE | Verify before decrypt |
| Anti-debug (renderer) | ✅ DONE | `src/security/antiDebug.ts` — DevTools size, timing, F12/Ctrl+Shift+I block |
| Anti-debug (main) | ✅ DONE | `backend/security/antiDebug.ts` |
| CSP headers | ✅ DONE | Production: `self`, `app:`, `blob:`, HTTPS only via `session.webRequest` |
| Tamper detection | ⚠️ PARTIAL | `initTamperDetection()` + `checkTampering()` run on startup; hash checks conditional (return true if no expected hash or dev mode) |
| API request signing | ✅ DONE | `createSignedHeaders()` **wired** into `postJson()` — all API calls signed with `x-timestamp`, `x-nonce`, `x-signature`, `x-machine-id` |
| IPC rate limiting | ✅ DONE | `loginRateLimiter.check()` **applied** to `auth:login` handler |
| Hardcoded secrets | ⚠️ RISK | `INSTALLER_KEY` still visible in `stringEncryption.ts` |
| contextIsolation | ✅ DONE | All BrowserWindows |
| sandbox | ✅ DONE | `sandbox: true` — enabled |
| nodeIntegration | ✅ DONE | `nodeIntegration: false` |
| Environment detection | ✅ DONE | VM/sandbox check on startup, reports to server |
| Security monitoring | ✅ DONE | Event reporting to remote via `/api/security/report` |
| String encryption | ✅ DONE | Server URL decoded from encrypted strings at runtime |
| Path validation | ✅ DONE | `isValidAbsolutePath()` — null byte check, resolve, enforce absolute |
| Dialog property whitelist | ✅ DONE | Only `openFile/multiSelections/openDirectory` allowed |
| Window open handler | ✅ DONE | Block new windows, only `shell.openExternal` for HTTPS |
| Zod input validation | ✅ DONE | `shared/ipcSchemas.ts` — all payloads validated |
| PBKDF2 server-side | ✅ DONE | 100,000 iterations, SHA-256, random 16-byte salt |
| Nonce dedup (server) | ✅ DONE | D1 storage, 10-minute expiry |
| Auto-block engine (server) | ✅ DONE | Rules: nonce reuse, invalid signature, tampering, machine mismatch |
| JWT device tokens | ✅ DONE | `auth-v2-handlers.ts` — device token + refresh token |
| Audit log | ✅ DONE | Every auth event: IP, machineId, severity |
| Version gating | ✅ DONE | 3-tier: allow / block-old / block-version |

### Tóm tắt thay đổi so với đánh giá 2026-03-28:
- ~~`sandbox: false`~~ → **`sandbox: true`** ✅
- ~~API signing NOT wired~~ → **Đã wired vào `postJson()`** ✅
- ~~Rate limiter NOT applied~~ → **Đã apply cho `auth:login`** ✅
- ~~PBKDF2 10k iterations~~ → **300,000 iterations** ✅
- Tamper detection: vẫn conditional (return true nếu không có expected hash hoặc dev mode)
- `INSTALLER_KEY` hardcoded: vẫn còn — cần giải quyết

---

## Kiến trúc bảo mật hiện tại

### Tầng 1: Electron Security

```
┌─────────────────────────────────────────────────────────┐
│  Renderer (Sandboxed)                                   │
│  • contextIsolation: true                               │
│  • nodeIntegration: false                               │
│  • sandbox: true                                        │
│  • CSP headers (production)                             │
│  • Anti-debug: DevTools size, timing, key intercept     │
│  • setWindowOpenHandler: block all, HTTPS→openExternal  │
├─────────────────────────────────────────────────────────┤
│  Preload (contextBridge)                                │
│  • Chỉ expose API cần thiết                             │
│  • Dialog property whitelist                            │
│  • Path validation trước mọi file operation             │
├─────────────────────────────────────────────────────────┤
│  Main Process                                           │
│  • Tamper detection on startup                          │
│  • Environment detection (VM/sandbox)                   │
│  • Security monitoring + event reporting                │
│  • String encryption cho sensitive URLs                 │
│  • rootDir containment cho file delete                  │
│  • FFmpeg graceful kill on quit                         │
└─────────────────────────────────────────────────────────┘
```

### Tầng 2: Auth & Credential Security

```
Encrypted Auth Store (.enc file)
├── AES-256-GCM encryption
├── PBKDF2 key derivation (300,000 iterations)
├── Machine-ID binding (SHA-256 hardware hash)
├── HMAC-SHA256 integrity check
└── Mismatch → null return (fail-secure)

Login Flow
├── Rate limiter per-username
├── HMAC-SHA256 request signing
├── Timestamp + nonce (replay prevention)
└── Tamper count check (≥3 events in 24h → block)
```

### Tầng 3: API Communication Security

```
Client → Server (every request)
├── x-timestamp (±5 min tolerance)
├── x-nonce (unique, 10-min expiry in D1)
├── x-signature (HMAC-SHA256 of timestamp|nonce|method|path|body)
├── x-machine-id
└── Zod schema validation on both sides

Server Security
├── PBKDF2 password hashing (100k iterations, random salt)
├── Timing-safe comparison (XOR-based)
├── Nonce dedup in D1 (reject duplicates)
├── Auto-block engine:
│   ├── NONCE_REUSED → instant block
│   ├── SIGNATURE_INVALID → 5 in 5min → block
│   ├── TAMPERING_DETECTED → instant block
│   ├── LICENSE_CHECK_FAILED → 10 in 10min → revoke
│   └── MACHINE_ID_MISMATCH → 3 in 10min → block
├── JWT device tokens + refresh tokens
└── Audit log (IP, machineId, severity)
```

### Tầng 4: Version Control

```
Version Gating (3-tier)
├── allow → normal app usage
├── block-old → auto-update flow (electron-updater)
└── block-version → forced installer download

Version Policy (Cloudflare Worker)
├── GET /api/version-policy → public
├── POST /api/admin/version-policy/update → admin only
└── Configurable: latest, min supported, blocked versions
```

---

## Remaining Risks & TODO

| # | Risk | Severity | Status |
|---|------|----------|--------|
| 1 | `INSTALLER_KEY` hardcoded in `stringEncryption.ts` | ⚠️ MEDIUM | Cần move to env/build-time inject |
| 2 | Tamper detection conditional (return true in dev/no hash) | ⚠️ LOW | Acceptable for dev workflow, enforce in production build |
| 3 | Code obfuscation chưa triển khai | 🟡 LOW | JS readable, nhưng có string encryption |
| 4 | Salt trong encryptedAuthStore | ⚠️ MEDIUM | Cần review nếu hardcoded |

---

## Tài Liệu Tham Khảo

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Electron Security Best Practices](https://www.electronjs.org/docs/latest/tutorial/security)
- [NIST SP 800-132 — PBKDF2 Recommendations](https://csrc.nist.gov/publications/detail/sp/800-132/final)
- Security Audit Report: [`SECURITY_AUDIT_REPORT_v3.6.0.md`](./SECURITY_AUDIT_REPORT_v3.6.0.md)
- Security Refactoring Report: [`SECURITY_REFACTORING_COMPLETE_REPORT.md`](./SECURITY_REFACTORING_COMPLETE_REPORT.md)
