/**
 * Wave Style Plugin System — Registry.
 *
 * Central registry cho tất cả wave styles.
 * Mỗi wave file gọi registerWave() để tự đăng ký.
 *
 * CÁCH THÊM WAVE MỚI:
 * 1. Tạo file mới: waves/myNewWave.ts
 * 2. Import helpers cần thiết
 * 3. Implement WaveDrawFn
 * 4. Gọi registerWave('myNewWave', drawFn, meta)
 * 5. Import file trong waves/index.ts
 *
 * → Không cần sửa drawLayers.ts, không cần sửa registry.ts!
 */

import type { WaveDrawFn, WaveStyleMeta, WaveStyleEntry, WaveStateCleanup } from './types'

// ═══════════════════════════════════════════════════════════════════════════════
//  REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

const _registry = new Map<string, WaveStyleEntry>()
const _cleanups: WaveStateCleanup[] = []

/**
 * Đăng ký một wave style mới.
 *
 * @param id    Unique identifier (e.g. 'bars', 'helix', 'aurora')
 * @param draw  Hàm vẽ (WaveDrawFn)
 * @param meta  Metadata cho UI (label, icon, category)
 *
 * @example
 * ```ts
 * // waves/myWave.ts
 * import { registerWave } from './registry'
 * import { resolveColorRgba, animTimeMs } from './helpers'
 *
 * function drawWaveMyWave(ctx, w, h, amplitude, samples, spectrum, bands, vc, beat) {
 *   // ... vẽ ...
 * }
 *
 * registerWave('myWave', drawWaveMyWave, {
 *   id: 'myWave',
 *   label: 'Sóng của tôi',
 *   icon: '🌊',
 *   category: 'artistic',
 * })
 * ```
 */
export function registerWave(
  id: string,
  draw: WaveDrawFn,
  meta: WaveStyleMeta
): void {
  if (_registry.has(id)) {
    console.warn(`[WaveRegistry] Wave style "${id}" already registered, overwriting.`)
  }
  _registry.set(id, { draw, meta })
}

/**
 * Đăng ký cleanup function cho persistent state.
 * Sẽ được gọi khi resetAllWaveState().
 */
export function registerWaveCleanup(cleanup: WaveStateCleanup): void {
  _cleanups.push(cleanup)
}

/**
 * Lấy hàm vẽ cho wave style ID.
 * Trả về null nếu không tìm thấy.
 */
export function getWaveDrawFn(id: string): WaveDrawFn | null {
  return _registry.get(id)?.draw ?? null
}

/**
 * Lấy metadata của wave style.
 */
export function getWaveMeta(id: string): WaveStyleMeta | null {
  return _registry.get(id)?.meta ?? null
}

/**
 * Lấy tất cả registered wave style IDs.
 */
export function getAllWaveIds(): string[] {
  return Array.from(_registry.keys())
}

/**
 * Lấy tất cả metadata — dùng cho UI (InspectorPanel).
 * Sorted: theo thứ tự đăng ký (insertion order of Map).
 */
export function getAllWaveMetas(): WaveStyleMeta[] {
  return Array.from(_registry.values()).map(e => e.meta)
}

/**
 * Lấy toàn bộ registry entries.
 */
export function getAllWaveEntries(): Map<string, WaveStyleEntry> {
  return _registry
}

/**
 * Kiểm tra wave style có tồn tại không.
 */
export function hasWaveStyle(id: string): boolean {
  return _registry.has(id)
}

/**
 * Reset TẤT CẢ persistent wave state.
 * Gọi khi:
 * - Chuyển bài (switch tracks)
 * - Destroy runtime
 * - Tránh "ghost" animation từ session trước
 */
export function resetAllWaveState(): void {
  for (const cleanup of _cleanups) {
    try { cleanup() } catch (e) {
      console.warn('[WaveRegistry] Cleanup error:', e)
    }
  }
}

/**
 * Tổng số wave styles đã đăng ký.
 */
export function getWaveCount(): number {
  return _registry.size
}
