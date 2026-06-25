---
name: release-safety-check
description: Workflow before build, packaging, updater changes, version-policy changes, server deploys, or release.
---

# Release Safety Check

Use before building, packaging, updating, deploying server changes, or shipping auth/license/security/media pipeline changes.

## Steps

1. Review the working tree diff and affected subsystems.
2. Check app version and version policy defaults.
3. Check `.env.production.example` is complete but secret-free.
4. Check bundled resources and media binaries.
5. Check updater behavior and active export install guard.
6. Run or recommend relevant verification: `npm run build`, `npx tsc --noEmit`, targeted Vitest, or Playwright.
7. Use `build-release-specialist` for release/build review.
8. Use `security-hardening-reviewer` for auth, updater, or security-sensitive release paths.

## Checklist

- No secrets committed.
- No dev-only absolute paths.
- Packaged Windows paths handled.
- Current app version is not accidentally blocked.
- Update install cannot kill active exports.
- Scripts do not delete unexpected folders.

## Report

Return pass/fail summary, commands run, blockers, warnings, and next action.
