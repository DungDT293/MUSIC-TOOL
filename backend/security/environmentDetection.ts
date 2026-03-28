/**
 * Environment Detection
 * Phát hiện VM, sandbox, và môi trường không an toàn
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

interface EnvironmentCheckResult {
  safe: boolean
  reason?: string
  detected?: string[]
}

/**
 * Detect Virtual Machine
 */
export async function detectVM(): Promise<{ detected: boolean; type?: string }> {
  if (process.platform !== 'win32') {
    return { detected: false }
  }

  const vmIndicators: { type: string; checks: Array<{ command: string; args: string[]; pattern?: RegExp }> }[] = [
    {
      type: 'VMware',
      checks: [
        { command: 'wmic', args: ['path', 'Win32_BaseBoard', 'get', 'Product'] },
        { command: 'wmic', args: ['path', 'Win32_BIOS', 'get', 'Manufacturer'] },
        { command: 'reg', args: ['query', 'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\vmware'] },
      ],
    },
    {
      type: 'VirtualBox',
      checks: [
        { command: 'wmic', args: ['path', 'Win32_BaseBoard', 'get', 'Product'] },
        { command: 'wmic', args: ['path', 'Win32_BIOS', 'get', 'Manufacturer'] },
        { command: 'reg', args: ['query', 'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\VBoxGuest'] },
      ],
    },
    {
      type: 'QEMU',
      checks: [
        { command: 'wmic', args: ['path', 'Win32_BaseBoard', 'get', 'Product'] },
        { command: 'wmic', args: ['path', 'Win32_BIOS', 'get', 'Manufacturer'] },
      ],
    },
    {
      type: 'Hyper-V',
      checks: [
        { command: 'wmic', args: ['path', 'Win32_BaseBoard', 'get', 'Product'] },
        { command: 'wmic', args: ['path', 'Win32_BIOS', 'get', 'Manufacturer'] },
      ],
    },
  ]

  for (const vm of vmIndicators) {
    for (const check of vm.checks) {
      try {
        const { stdout } = await execFileAsync(check.command, check.args, {
          windowsHide: true,
          timeout: 3000,
        } as any)

        const output = stdout.toLowerCase()
        const vmKeywords: Record<string, string[]> = {
          VMware: ['vmware', 'vmware, inc.'],
          VirtualBox: ['virtualbox', 'innotek', 'oracle'],
          QEMU: ['qemu', 'bochs'],
          'Hyper-V': ['microsoft corporation', 'hyper-v'],
        }

        const keywords = vmKeywords[vm.type] || []
        for (const keyword of keywords) {
          if (output.includes(keyword)) {
            return { detected: true, type: vm.type }
          }
        }
      } catch {
        // Ignore errors
      }
    }
  }

  return { detected: false }
}

/**
 * Detect Sandbox Environment
 */
export async function detectSandbox(): Promise<{ detected: boolean; type?: string }> {
  if (process.platform !== 'win32') {
    return { detected: false }
  }

  const sandboxIndicators: { type: string; processNames: string[] }[] = [
    {
      type: 'Sandboxie',
      processNames: ['sandboxiedcomlaunch.exe', 'sandboxierpcss.exe', 'sandboxiedcomlaunch.exe'],
    },
    {
      type: 'Cuckoo',
      processNames: ['cuckoo.exe', 'cuckoo-sandbox.exe'],
    },
    {
      type: 'JoeBox',
      processNames: ['joeboxserver.exe', 'joeboxcontrol.exe'],
    },
    {
      type: 'Anubis',
      processNames: ['anubis.exe'],
    },
  ]

  try {
    const { stdout } = await execFileAsync('tasklist', ['/FO', 'CSV', '/NH'], {
      windowsHide: true,
      timeout: 3000,
    } as any)

    const processes = stdout.toLowerCase()
    for (const sandbox of sandboxIndicators) {
      for (const processName of sandbox.processNames) {
        if (processes.includes(processName.toLowerCase())) {
          return { detected: true, type: sandbox.type }
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return { detected: false }
}

/**
 * Check if environment is safe
 */
export async function isSafeEnvironment(): Promise<EnvironmentCheckResult> {
  // Skip check trong development mode
  if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
    return { safe: true }
  }

  const detected: string[] = []

  // Check VM
  const vmResult = await detectVM()
  if (vmResult.detected) {
    detected.push(`VM detected: ${vmResult.type}`)
  }

  // Check Sandbox
  const sandboxResult = await detectSandbox()
  if (sandboxResult.detected) {
    detected.push(`Sandbox detected: ${sandboxResult.type}`)
  }

  if (detected.length > 0) {
    return {
      safe: false,
      reason: `Unsafe environment detected: ${detected.join(', ')}`,
      detected,
    }
  }

  return { safe: true }
}


