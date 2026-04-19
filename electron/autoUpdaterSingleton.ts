/**
 * Singleton wrapper cho electron-updater autoUpdater.
 *
 * Vấn đề: Khi Vite bundle, mỗi `await import('electron-updater')` có thể
 * trả về module khác nhau hoặc autoUpdater undefined. File này đảm bảo
 * chỉ import 1 lần duy nhất và chia sẻ instance cho toàn bộ main process.
 */

import type { AppUpdater } from 'electron-updater'

let _autoUpdater: AppUpdater | null = null
let _initPromise: Promise<AppUpdater | null> | null = null

/**
 * Lấy autoUpdater instance (lazy init, chỉ import 1 lần).
 * Trả về null nếu electron-updater không khả dụng (dev mode, import fail).
 */
export async function getAutoUpdater(): Promise<AppUpdater | null> {
  if (_autoUpdater) return _autoUpdater

  if (_initPromise) return _initPromise

  _initPromise = (async () => {
    try {
      const mod = await import('electron-updater')
      const updater = mod?.autoUpdater ?? mod?.default
      if (!updater) {
        console.warn('[AutoUpdater] electron-updater did not expose autoUpdater')
        return null
      }
      _autoUpdater = updater
      return _autoUpdater
    } catch (err: any) {
      console.warn('[AutoUpdater] Failed to import electron-updater:', err?.message)
      return null
    }
  })()

  return _initPromise
}
