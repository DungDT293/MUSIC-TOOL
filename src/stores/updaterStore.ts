/**
 * Global Updater Store
 *
 * FIX 4.2: Persists updater status across page navigations.
 * Previously, `updaterStatus` was local state in SettingsPage.tsx,
 * so navigating away from Settings would lose download progress,
 * "update downloaded" status, etc.
 *
 * Now SettingsPage and any other component can read/write this store
 * and the state survives the full app session.
 */

import { create } from 'zustand'
import type { UpdaterStatusPayload } from '../types/ipc'

interface UpdaterStoreState {
  /** Current updater status — survives page navigation */
  status: UpdaterStatusPayload

  /** Timestamp of last successful check (for debounce display) */
  lastCheckAt: number | null

  /** Set updater status from IPC event */
  setStatus: (status: UpdaterStatusPayload) => void

  /** Record that a check was initiated */
  recordCheck: () => void

  /** Whether a check is allowed (10-second client-side debounce) */
  canCheck: () => boolean
}

const CHECK_DEBOUNCE_MS = 10_000

export const useUpdaterStore = create<UpdaterStoreState>((set, get) => ({
  status: { state: 'idle' },
  lastCheckAt: null,

  setStatus: (status) => set({ status }),

  recordCheck: () => set({ lastCheckAt: Date.now() }),

  canCheck: () => {
    const { lastCheckAt, status } = get()
    // Block if already checking or downloading
    if (status.state === 'checking' || status.state === 'downloading') return false
    // Block if checked within debounce window
    if (lastCheckAt && Date.now() - lastCheckAt < CHECK_DEBOUNCE_MS) return false
    return true
  },
}))
