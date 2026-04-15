/**
 * handlers/index.ts
 * Tổng hợp và export tất cả register functions.
 * main.ts chỉ cần gọi registerAllHandlers(mainWindow).
 */

import type { BrowserWindow } from 'electron'
import { registerAuthHandlers } from './authHandlers'
import { registerSystemHandlers } from './systemHandlers'
import { registerMusicHandlers } from './musicHandlers'
import { registerVideoHandlers } from './videoHandlers'
import { registerVideoFinalExportHandlers } from './videoFinalExportHandlers'
import { registerSongNhacHandlers } from './songNhacHandlers'

export function registerAllHandlers(
  mainWindow: BrowserWindow | null,
  getMainWindow: () => BrowserWindow | null
) {
  registerAuthHandlers()
  registerSystemHandlers(mainWindow)
  registerMusicHandlers(getMainWindow)
  registerVideoHandlers()
  registerVideoFinalExportHandlers(getMainWindow)
  registerSongNhacHandlers(getMainWindow)
}

// Re-export helper utilities needed by main.ts
export { refreshLicenseState, getLicenseState } from './authHandlers'
export { refreshDiskInfoAndBroadcast } from './systemHandlers'
export { activeSongNhacExports } from './songNhacHandlers'
