/**
 * Chức năng 13 — FPS meter.
 * Đếm frame mỗi RAF; mỗi fpsReportIntervalMs tính fps và gọi onFps.
 * Không tính trong React.
 */

export function createFpsMeter(
  onFps: (fps: number) => void,
  intervalMs: number = 500
) {
  let frameCount = 0
  let lastReportTime = 0

  function tick() {
    frameCount++
    const now = performance.now()
    const elapsed = now - lastReportTime
    if (elapsed >= intervalMs) {
      const fps = elapsed > 0 ? (frameCount / elapsed) * 1000 : 0
      onFps(Math.round(fps))
      frameCount = 0
      lastReportTime = now
    }
  }

  function reset() {
    frameCount = 0
    lastReportTime = performance.now()
  }

  return { tick, reset }
}
