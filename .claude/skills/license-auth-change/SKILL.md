---
name: license-auth-change
description: Workflow for changes to license, auth, JWT/device tokens, version policy, Cloudflare Worker server, admin endpoints, and security verification.
---

# License/Auth Change Workflow

Use when changing app auth, license state, server auth handlers, admin endpoints, version policy, JWT/device tokens, or security verification.

## Steps

1. Identify whether the change affects Electron client, Worker server, or both.
2. Trace allowed, pending, blocked, locked, revoked, offline, and error states end-to-end.
3. Keep secrets in Worker env or Electron main process only.
4. Check fail-open/fail-closed behavior is intentional.
5. Update shared types or response handling if contracts changed.
6. Use `cloudflare-license-specialist` for server/license review.
7. Use `security-hardening-reviewer` for bypass and secret-leak review.
8. Verify with targeted auth/license tests or manual state matrix.

## Checklist

- Admin routes are protected.
- Tokens expire and refresh correctly.
- Blocked users are not silently allowed.
- Offline behavior matches product intent.
- Version policy does not accidentally block the current release.
- Logs do not include secrets.

## Report

Summarize affected states, contract changes, verification, and release risk.
