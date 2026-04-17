/**
 * Global Export Activity Store
 *
 * FIX C-01 / H-05: Tracks whether ANY export is currently running across the app.
 * Used by App.tsx to DELAY auth/license teardown when an export is in progress,
 * preventing data loss from mid-export unmounting.
 *
 * Both FinalExportTab and SongNhac ExportDialog register/unregister here.
 */

import { create } from 'zustand'

export interface ExportActivityEntry {
  /** Unique ID for this export (requestId or jobId) */
  id: string
  /** Human-readable label for the warning dialog */
  label: string
  /** Timestamp when registered */
  startedAt: number
}

interface ExportActivityState {
  /** Currently active exports across all features */
  activeExports: ExportActivityEntry[]

  /** True if at least one export is in progress */
  hasActiveExport: () => boolean

  /** Register an export as active */
  registerExport: (id: string, label: string) => void

  /** Unregister an export (completed, failed, or cancelled) */
  unregisterExport: (id: string) => void

  /**
   * Auth/license denial is pending — but delayed because an export is running.
   * Stores the denial reason for the warning banner.
   */
  pendingDenial: { reason: string; type: 'auth-blocked' | 'license-denied' } | null

  /** Set a pending denial (will be acted upon when exports finish) */
  setPendingDenial: (denial: { reason: string; type: 'auth-blocked' | 'license-denied' }) => void

  /** Clear pending denial (e.g., if user dismisses it) */
  clearPendingDenial: () => void
}

export const useExportActivityStore = create<ExportActivityState>((set, get) => ({
  activeExports: [],

  hasActiveExport: () => get().activeExports.length > 0,

  registerExport: (id, label) =>
    set((state) => {
      // Avoid duplicates
      if (state.activeExports.some((e) => e.id === id)) return state
      return {
        activeExports: [
          ...state.activeExports,
          { id, label, startedAt: Date.now() },
        ],
      }
    }),

  unregisterExport: (id) =>
    set((state) => ({
      activeExports: state.activeExports.filter((e) => e.id !== id),
    })),

  pendingDenial: null,

  setPendingDenial: (denial) => set({ pendingDenial: denial }),

  clearPendingDenial: () => set({ pendingDenial: null }),
}))
