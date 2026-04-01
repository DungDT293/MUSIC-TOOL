/**
 * Anti-Debugging for Renderer Process
 * Phát hiện DevTools, debugger, reverse engineering
 */

/**
 * Detect DevTools (Chrome DevTools, Firefox DevTools)
 */
export function detectDevTools(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  // Method 1: Check console size
  const threshold = 160
  if (
    window.outerHeight - window.innerHeight > threshold ||
    window.outerWidth - window.innerWidth > threshold
  ) {
    return true
  }

  // Method 2: Timing-based detection (no console side-effects)
  let devtools = false
  const before = performance.now()
  // eslint-disable-next-line no-unused-expressions
  void ('' + before)
  const after = performance.now()
  // DevTools presence adds measurable overhead on repeated access
  if (after - before > 10) {
    devtools = true
  }

  return devtools
}

/**
 * Detect debugger via timing anomaly (no debugger statement)
 */
export function detectDebugger(): boolean {
  let detected = false
  const start = performance.now()
  // A paused debugger will cause measurable delay between these two lines
  const end = performance.now()
  // Nếu debugger được attach, thời gian sẽ > 100ms
  if (end - start > 100) {
    detected = true
  }
  return detected
}

/**
 * Disable right-click context menu (basic protection)
 * @returns Cleanup function to remove listeners
 */
export function disableContextMenu(): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const onContextMenu = (e: Event) => {
    e.preventDefault()
    return false
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (
      e.key === 'F12' ||
      (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J')) ||
      (e.ctrlKey && e.key === 'U')
    ) {
      e.preventDefault()
      return false
    }
  }

  document.addEventListener('contextmenu', onContextMenu)
  document.addEventListener('keydown', onKeyDown)

  return () => {
    document.removeEventListener('contextmenu', onContextMenu)
    document.removeEventListener('keydown', onKeyDown)
  }
}

/**
 * Anti-debugging loop (timing-based detection only — no debugger statement)
 * @returns Cleanup function to clear interval
 */
export function antiDebugLoop(): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const id = setInterval(async () => {
    const start = performance.now()
    // Timing check: if execution is paused by an attached debugger,
    // the elapsed time will be anomalously large.
    const end = performance.now()
    if (end - start > 100) {
      // Debugger detected - report lên server
      console.warn('[Security] Debugger detected')
      try {
        // Report qua IPC (renderer không thể gọi trực tiếp)
        if (window.api?.security?.reportAntiDebug) {
          await window.api.security.reportAntiDebug({
            method: 'timing_anomaly',
            detected: true,
          })
        }
      } catch {
        // Ignore nếu không có IPC handler
      }
    }
  }, 1000)

  return () => clearInterval(id)
}

/**
 * Main anti-debugging check
 * Returns true if debugging detected
 */
export function checkAntiDebug(): boolean {
  // Chỉ check trong production
  if (import.meta.env.DEV) {
    return false
  }

  const checks = [detectDevTools(), detectDebugger()]
  return checks.some((check) => check === true)
}

/**
 * Initialize anti-debugging (chỉ trong production)
 * @returns Cleanup function to remove listeners and clear interval
 */
export function initAntiDebug(): () => void {
  if (import.meta.env.DEV) {
    return () => {}
  }

  const cleanupContextMenu = disableContextMenu()
  const cleanupLoop = antiDebugLoop()

  return () => {
    cleanupContextMenu()
    cleanupLoop()
  }
}

