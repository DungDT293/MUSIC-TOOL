/**
 * Singleton wrapper cho electron-updater autoUpdater.
 *
 * Vấn đề: Khi Vite bundle, `await import('electron-updater')` bị transform
 * khiến module interop hỏng → autoUpdater undefined hoặc không phải AppUpdater.
 *
 * Giải pháp: Dùng Node.js `createRequire` để bypass Vite bundler hoàn toàn,
 * load trực tiếp từ node_modules như CommonJS require().
 */

import type { AppUpdater } from 'electron-updater'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

let _autoUpdater: AppUpdater | null = null

/**
 * Lấy autoUpdater instance (lazy init, chỉ require 1 lần).
 * Dùng createRequire() để bypass Vite transform.
 * Trả về null nếu electron-updater không khả dụng (dev mode, require fail).
 */
export function getAutoUpdater(): AppUpdater | null {
  if (_autoUpdater) return _autoUpdater

  try {
    // createRequire tạo require() function thực sự của Node.js,
    // hoàn toàn bypass Vite bundler transform.
    // Dùng __filename fallback vì import.meta.url có thể bị Vite transform.
    const baseUrl = typeof __filename !== 'undefined'
      ? pathToFileURL(__filename).href
      : import.meta.url
    const nativeRequire = createRequire(baseUrl)
    const mod = nativeRequire('electron-updater')
    const updater = mod?.autoUpdater ?? mod?.default?.autoUpdater ?? mod?.default
    if (!updater) {
      console.warn('[AutoUpdater] electron-updater did not expose autoUpdater. Keys:', Object.keys(mod || {}).join(', '))
      return null
    }
    // Validate: phải có checkForUpdates method
    if (typeof updater.checkForUpdates !== 'function') {
      console.warn('[AutoUpdater] autoUpdater.checkForUpdates is not a function')
      console.warn('[AutoUpdater] typeof updater:', typeof updater)
      console.warn('[AutoUpdater] updater keys:', Object.keys(updater).join(', '))
      // Try deeper: maybe updater is a wrapper
      if (updater.autoUpdater && typeof updater.autoUpdater.checkForUpdates === 'function') {
        console.log('[AutoUpdater] Found nested autoUpdater, using that instead')
        _autoUpdater = updater.autoUpdater
        return _autoUpdater
      }
      return null
    }
    _autoUpdater = updater
    console.log('[AutoUpdater] Successfully loaded electron-updater via createRequire')
    return _autoUpdater
  } catch (err: any) {
    console.warn('[AutoUpdater] Failed to require electron-updater:', err?.message)
    return null
  }
}
