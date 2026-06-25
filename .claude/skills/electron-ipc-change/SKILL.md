---
name: electron-ipc-change
description: Workflow for adding or changing Electron IPC handlers, preload APIs, renderer types, sidecars, dialogs, and lifecycle wiring.
---

# Electron IPC Change Workflow

Use when changing `ipcMain`, `ipcRenderer`, `electron/preload.ts`, `src/types/ipc.ts`, handler registration, dialogs, sidecar processes, or app lifecycle wiring.

## Steps

1. Define the smallest renderer API needed.
2. Add or update the main-process handler.
3. Validate renderer payloads before filesystem, network, or process actions.
4. Keep secrets and raw service access in the main process.
5. Expose a narrow preload wrapper.
6. Update `IPCAPI` in `src/types/ipc.ts`.
7. Register new handler modules in `electron/handlers/index.ts`.
8. For events, return unsubscribe functions and clean up in React.
9. Use `electron-ipc-specialist` for contract review.
10. Use `security-hardening-reviewer` for secret, auth, or filesystem-sensitive changes.

## Checklist

- Every invoke has a registered handler.
- Channel names are namespaced.
- Payloads and returns are typed.
- Renderer cannot access arbitrary Node, shell, files, or secrets.
- Dev and packaged builds remain compatible.

## Report

List channel, payload, return type, owner file, verification, and risks.
