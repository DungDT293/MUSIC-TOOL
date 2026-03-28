import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const execFileAsync = promisify(execFile)

const CACHE_DIR = path.join(os.homedir(), '.93media')
const CACHE_FILE = path.join(CACHE_DIR, 'machine-id.txt')

// Optional override for environments where the home folder is not persistent.
// Example: set MACHINE_ID_FILE="D:\\myapp\\machine-id.txt"
const ENV_CACHE_FILE = process.env.MACHINE_ID_FILE

function readCachedMachineHash(): string | null {
  const candidates = [ENV_CACHE_FILE, CACHE_FILE].filter(Boolean) as string[]
  for (const file of candidates) {
    try {
      const content = fs.readFileSync(file, 'utf8').trim()
      if (content && /^[a-f0-9]{64}$/i.test(content)) {
        return content.toLowerCase()
      }
    } catch {
      // ignore and try next candidate
    }
  }
  return null
}

function writeCachedMachineHash(hash: string) {
  const targets = [ENV_CACHE_FILE, CACHE_FILE].filter(Boolean) as string[]
  for (const target of targets) {
    try {
      const dir = path.dirname(target)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(target, hash, 'utf8')
      return
    } catch (err) {
      // Log once for visibility; continue to next fallback.
      console.warn('[machineId] Cannot write cache to', target, '-', (err as any)?.message || err)
    }
  }
}

async function tryCommand(command: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(command, args, { windowsHide: true })
    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && line.toLowerCase() !== 'uuid' && line.toLowerCase() !== 'serialnumber')
    if (lines.length > 0) {
      return lines[0]
    }
    return null
  } catch {
    return null
  }
}

async function getWindowsHardwareId(): Promise<string | null> {
  const identifiers: string[] = []
  
  // CPU ID (ProcessorId)
  const cpuId = await tryCommand('wmic', ['cpu', 'get', 'ProcessorId'])
  if (cpuId) identifiers.push(`CPU:${cpuId}`)

  // Computer System UUID
  const uuid = await tryCommand('wmic', ['csproduct', 'get', 'uuid'])
  if (uuid) identifiers.push(`UUID:${uuid}`)

  // BIOS Serial
  const bios = await tryCommand('wmic', ['bios', 'get', 'serialnumber'])
  if (bios) identifiers.push(`BIOS:${bios}`)

  // Motherboard Serial
  const baseboard = await tryCommand('wmic', ['baseboard', 'get', 'serialnumber'])
  if (baseboard) identifiers.push(`MB:${baseboard}`)

  // Disk Serial (lấy ổ đầu tiên)
  const disk = await tryCommand('wmic', ['diskdrive', 'get', 'serialnumber'])
  if (disk) identifiers.push(`DISK:${disk}`)

  // MAC Address (primary network adapter)
  try {
    const interfaces = os.networkInterfaces()
    const macs: string[] = []
    for (const value of Object.values(interfaces)) {
      if (!value) continue
      for (const iface of value) {
        if (iface.mac && iface.mac !== '00:00:00:00:00:00' && !iface.internal) {
          macs.push(iface.mac)
        }
      }
    }
    macs.sort()
    if (macs.length > 0) {
      identifiers.push(`MAC:${macs[0]}`) // Lấy MAC đầu tiên
    }
  } catch {
    // Ignore
  }

  // Windows Installation ID (từ registry nếu có thể)
  try {
    const { execSync } = require('child_process')
    const winId = execSync('reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', {
      windowsHide: true,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const match = winId.match(/MachineGuid\s+REG_SZ\s+([a-f0-9-]+)/i)
    if (match && match[1]) {
      identifiers.push(`WINID:${match[1]}`)
    }
  } catch {
    // Ignore nếu không đọc được registry
  }

  if (identifiers.length === 0) {
    return null
  }

  // Sắp xếp để ổn định thứ tự, tránh thay đổi nhỏ gây đổi hash
  const unique = Array.from(new Set(identifiers)).sort()
  return unique.join('|')
}

function getUnixHardwareId(): string {
  const hostname = os.hostname()
  const interfaces = os.networkInterfaces()
  const macs: string[] = []
  for (const value of Object.values(interfaces)) {
    if (!value) continue
    for (const iface of value) {
      if (iface.mac && iface.mac !== '00:00:00:00:00:00') {
        macs.push(iface.mac)
      }
    }
  }
  macs.sort()
  return `${hostname}|${macs.join('|')}`
}

export async function getMachineHash(): Promise<string> {
  // Ưu tiên dùng hash đã cache để tránh đổi Machine ID khi update / thay đổi driver
  const cached = readCachedMachineHash()
  if (cached) {
    return cached
  }

  let raw: string | null = null
  if (process.platform === 'win32') {
    raw = await getWindowsHardwareId()
  }

  if (!raw) {
    raw = getUnixHardwareId()
  }

  // Chuẩn hóa và cố định: bỏ khoảng trắng + uppercase
  const normalized = raw.replace(/\s+/g, '').toUpperCase()
  const hash = crypto.createHash('sha256').update(normalized).digest('hex')

  // Ghi cache để các lần chạy sau giữ nguyên Machine ID
  writeCachedMachineHash(hash)
  return hash
}



