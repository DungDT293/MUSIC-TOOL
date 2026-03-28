/**
 * Chức năng 13 — Bước 5 + EXPORT VIDEO (UX). Export state: progress + cancel + dialog.
 * Chỉ UI state; không FFT, không store runtime/audio.
 */

import { create } from 'zustand'
import type { ExportProgress } from '../runtime/export/types'
import type { ExportConfigForBackend } from '../export/exportConfigTypes'

export type ExportDialogMode = 'setup' | 'progress' | 'done' | 'error'

interface SongNhacExportState {
  isExporting: boolean
  progress: ExportProgress | null
  cancelRequested: boolean
  error: string | null
  currentJobId: string | null
  /** Export dialog */
  exportDialogOpen: boolean
  exportDialogMode: ExportDialogMode
  suggestedRetryWithCpu: boolean
  retryConfig: ExportConfigForBackend | null
  setProgress: (p: ExportProgress | null) => void
  setExporting: (v: boolean) => void
  setError: (e: string | null) => void
  setCurrentJobId: (id: string | null) => void
  requestCancel: () => void
  clearCancel: () => void
  openExportDialog: () => void
  closeExportDialog: () => void
  setExportDialogMode: (mode: ExportDialogMode) => void
  setSuggestedRetry: (suggested: boolean, config: ExportConfigForBackend | null) => void
}

export const useSongNhacExportStore = create<SongNhacExportState>((set) => ({
  isExporting: false,
  progress: null,
  cancelRequested: false,
  error: null,
  currentJobId: null,
  exportDialogOpen: false,
  exportDialogMode: 'setup',
  suggestedRetryWithCpu: false,
  retryConfig: null,
  setProgress: (p) => set({ progress: p }),
  setExporting: (v) =>
    set({
      isExporting: v,
      ...(v ? {} : { progress: null, error: null, currentJobId: null, suggestedRetryWithCpu: false, retryConfig: null }),
    }),
  setError: (e) => set({ error: e }),
  setCurrentJobId: (id) => set({ currentJobId: id }),
  requestCancel: () => set({ cancelRequested: true }),
  clearCancel: () => set({ cancelRequested: false }),
  openExportDialog: () => set({ exportDialogOpen: true, exportDialogMode: 'setup', error: null, suggestedRetryWithCpu: false, retryConfig: null }),
  closeExportDialog: () =>
    set({
      exportDialogOpen: false,
      exportDialogMode: 'setup',
      suggestedRetryWithCpu: false,
      retryConfig: null,
      error: null,
    }),
  setExportDialogMode: (mode) => set({ exportDialogMode: mode }),
  setSuggestedRetry: (suggested, config) => set({ suggestedRetryWithCpu: suggested, retryConfig: config }),
}))
