/**
 * Anti-Debugging Utilities
 * Phát hiện và ngăn chặn debugger, DevTools, reverse engineering
 */

/**
 * Detect DevTools (Chrome DevTools, Firefox DevTools)
 */
export function detectDevTools(): boolean {
  if (typeof window === 'undefined') {
    return false // Node.js environment
  }

  // Method 1: Check console size
  const threshold = 160
  if (
    window.outerHeight - window.innerHeight > threshold ||
    window.outerWidth - window.innerWidth > threshold
  ) {
    return true
  }

  // Method 2: Check console object
  let devtools = false
  const element = new Image()
  Object.defineProperty(element, 'id', {
    get: function () {
      devtools = true
      return ''
    },
  })
  console.log(element)
  console.clear()

  return devtools
}

/**
 * Detect debugger statement
 */
export function detectDebugger(): boolean {
  let detected = false
  const start = Date.now()
  debugger // eslint-disable-line no-debugger
  const end = Date.now()
  // Nếu debugger được attach, thời gian sẽ > 100ms
  if (end - start > 100) {
    detected = true
  }
  return detected
}

/**
 * Detect common debugging tools (process names)
 */
export function detectDebuggerProcess(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof process === 'undefined' || process.platform !== 'win32') {
      resolve(false)
      return
    }

    const { exec } = require('child_process')
    exec('tasklist', { windowsHide: true }, (error: any, stdout: string) => {
      if (error) {
        resolve(false)
        return
      }

      const debuggerProcesses = [
        'ollydbg.exe',
        'x64dbg.exe',
        'x32dbg.exe',
        'windbg.exe',
        'ida.exe',
        'ida64.exe',
        'idaq.exe',
        'idaq64.exe',
        'ghidra.exe',
        'cheatengine.exe',
        'processhacker.exe',
        'procmon.exe',
        'wireshark.exe',
        'fiddler.exe',
        'charles.exe',
      ]

      const lowerStdout = stdout.toLowerCase()
      const found = debuggerProcesses.some((proc) => lowerStdout.includes(proc))
      resolve(found)
    })
  })
}

/**
 * Detect VM/Sandbox environment
 */
export function detectVM(): boolean {
  if (typeof process === 'undefined') {
    return false
  }

  // Check common VM indicators
  const vmIndicators = [
    'VMware',
    'VirtualBox',
    'VBOX',
    'QEMU',
    'Xen',
    'Bochs',
    'Parallels',
  ]

  const env = process.env
  const envString = JSON.stringify(env).toLowerCase()

  return vmIndicators.some((indicator) => envString.includes(indicator.toLowerCase()))
}

/**
 * Anti-debugging loop (làm chậm debugger)
 */
export function antiDebugLoop(): void {
  if (typeof window === 'undefined') {
    return
  }

  setInterval(() => {
    const start = Date.now()
    debugger // eslint-disable-line no-debugger
    const end = Date.now()
    if (end - start > 100) {
      // Debugger detected - có thể log hoặc thực hiện action
      console.warn('[Security] Debugger detected')
    }
  }, 1000)
}

/**
 * Disable right-click context menu (basic protection)
 */
export function disableContextMenu(): void {
  if (typeof window === 'undefined') {
    return
  }

  document.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    return false
  })

  // Disable F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U
  document.addEventListener('keydown', (e) => {
    if (
      e.key === 'F12' ||
      (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J')) ||
      (e.ctrlKey && e.key === 'U')
    ) {
      e.preventDefault()
      return false
    }
  })
}

/**
 * Main anti-debugging check
 * Returns true if debugging detected
 */
export async function checkAntiDebug(): Promise<boolean> {
  // Chỉ check trong production
  if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_RENDERER_URL) {
    return false
  }

  const checks = [
    detectDevTools(),
    detectDebugger(),
    detectVM(),
  ]

  // Check process (async)
  const processCheck = await detectDebuggerProcess()
  checks.push(processCheck)

  return checks.some((check) => check === true)
}

/**
 * Initialize anti-debugging (chỉ trong production)
 */
export function initAntiDebug(): void {
  if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_RENDERER_URL) {
    return // Skip in dev mode
  }

  // Disable context menu
  if (typeof window !== 'undefined') {
    disableContextMenu()
  }

  // Start anti-debug loop (chỉ trong renderer)
  if (typeof window !== 'undefined') {
    antiDebugLoop()
  }
}


