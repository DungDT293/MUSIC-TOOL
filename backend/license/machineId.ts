import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const execFileAsync = promisify(execFile)

// ─── Cache path ────────────────────────────────────────────────────────────
// Dùng %APPDATA% (Roaming) thay vì ~/.93media để tránh bị cleanup tools xóa.
// %APPDATA% = C:\Users\<name>\AppData\Roaming — ít bị CCleaner/BleachBit đụng hơn.
function resolveDefaultCacheFile(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(appData, '93MediaToolMixNhac', 'machine-id.txt')
  }
  return path.join(os.homedir(), '.93media', 'machine-id.txt')
}

// Fallback thứ 2: ProgramData (bền vững hơn, shared giữa users trên cùng máy)
function resolveProgramDataCacheFile(): string {
  if (process.platform === 'win32') {
    const programData = process.env.PROGRAMDATA || path.join('C:', 'ProgramData')
    return path.join(programData, '93MediaToolMixNhac', 'machine-id.txt')
  }
  return path.join('/var/lib', '93media', 'machine-id.txt')
}

// Optional override qua env var
const ENV_CACHE_FILE = process.env.MACHINE_ID_FILE

function readCachedMachineHash(): string | null {
  const candidates = [
    ENV_CACHE_FILE,
    resolveDefaultCacheFile(),
    resolveProgramDataCacheFile(),
  ].filter(Boolean) as string[]

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
  const targets = [
    ENV_CACHE_FILE,
    resolveDefaultCacheFile(),
    resolveProgramDataCacheFile(),
  ].filter(Boolean) as string[]

  for (const target of targets) {
    try {
      const dir = path.dirname(target)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(target, hash, 'utf8')
      return // ghi thành công 1 file là đủ
    } catch (err) {
      console.warn('[machineId] Cannot write cache to', target, '-', (err as any)?.message || err)
    }
  }
}

// ─── Command helpers ───────────────────────────────────────────────────────

async function tryCommand(command: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(command, args, { windowsHide: true, timeout: 5000 })
    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && line.toLowerCase() !== 'uuid' && line.toLowerCase() !== 'serialnumber' && line.toLowerCase() !== 'processorid')
    if (lines.length > 0) {
      return lines[0]
    }
    return null
  } catch {
    return null
  }
}

// PowerShell fallback cho wmic (deprecated trên Windows 11)
async function tryPowerShell(script: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 8000 }
    )
    const result = stdout.trim().replace(/\s+/g, '')
    return result || null
  } catch {
    return null
  }
}

// ─── MAC address helpers ───────────────────────────────────────────────────

/**
 * Prefixes của virtual/VPN network adapter thường gặp.
 * Các MAC bắt đầu bằng các prefix này sẽ bị bỏ qua để tránh hash không ổn định
 * khi user cài/gỡ VPN, Docker, Hyper-V, VMware...
 */
const VIRTUAL_MAC_PREFIXES = [
  '00:05:69', // VMware
  '00:0c:29', // VMware
  '00:50:56', // VMware
  '00:1c:14', // VMware
  '08:00:27', // VirtualBox
  '52:54:00', // QEMU/KVM
  '00:15:5d', // Hyper-V
  '02:42:',   // Docker (bridge)
  '00:ff:',   // WireGuard / generic VPN
  '12:',      // Locally administered (random MAC — VPN, tap, tun)
  '16:',
  '1a:',
  '1e:',
  '02:',      // Locally administered bit set (LSB của byte đầu là 1)
]

function isVirtualMac(mac: string): boolean {
  const lower = mac.toLowerCase()
  // Locally administered MAC: bit 1 (LSB) của octet đầu = 1
  // VD: x2:..., x6:..., xa:..., xe:...
  const firstOctet = parseInt(lower.split(':')[0], 16)
  if (!isNaN(firstOctet) && (firstOctet & 0x02) !== 0) {
    return true
  }
  return VIRTUAL_MAC_PREFIXES.some((prefix) => lower.startsWith(prefix.toLowerCase()))
}

function getPhysicalMacs(): string[] {
  const interfaces = os.networkInterfaces()
  const macs: string[] = []
  for (const value of Object.values(interfaces)) {
    if (!value) continue
    for (const iface of value) {
      if (
        iface.mac &&
        iface.mac !== '00:00:00:00:00:00' &&
        !iface.internal &&
        !isVirtualMac(iface.mac)
      ) {
        macs.push(iface.mac.toLowerCase())
      }
    }
  }
  return Array.from(new Set(macs)).sort()
}

// ─── Windows hardware ID ───────────────────────────────────────────────────

async function getWindowsHardwareId(): Promise<string | null> {
  const identifiers: string[] = []

  // --- Thử wmic trước (Windows 10 và cũ hơn) ---
  const [cpuWmic, uuidWmic, biosWmic, mbWmic, diskWmic] = await Promise.all([
    tryCommand('wmic', ['cpu', 'get', 'ProcessorId']),
    tryCommand('wmic', ['csproduct', 'get', 'uuid']),
    tryCommand('wmic', ['bios', 'get', 'serialnumber']),
    tryCommand('wmic', ['baseboard', 'get', 'serialnumber']),
    tryCommand('wmic', ['diskdrive', 'get', 'serialnumber']),
  ])

  // --- Nếu wmic fail (Windows 11+), dùng PowerShell CIM ---
  const cpuId = cpuWmic ?? await tryPowerShell('(Get-CimInstance Win32_Processor).ProcessorId')
  const uuid  = uuidWmic ?? await tryPowerShell('(Get-CimInstance Win32_ComputerSystemProduct).UUID')
  const bios  = biosWmic ?? await tryPowerShell('(Get-CimInstance Win32_BIOS).SerialNumber')
  const mb    = mbWmic   ?? await tryPowerShell('(Get-CimInstance Win32_BaseBoard).SerialNumber')
  // Disk: lấy serial của ổ đĩa KHÔNG phải USB (MediaType = Fixed hard disk media)
  const disk  = diskWmic ?? await tryPowerShell(
    '(Get-CimInstance Win32_DiskDrive | Where-Object {$_.MediaType -like "*Fixed*"} | Select-Object -First 1).SerialNumber'
  )

  if (cpuId) identifiers.push(`CPU:${cpuId}`)
  if (uuid)  identifiers.push(`UUID:${uuid}`)
  if (bios)  identifiers.push(`BIOS:${bios}`)
  if (mb)    identifiers.push(`MB:${mb}`)
  if (disk)  identifiers.push(`DISK:${disk}`)

  // MAC: chỉ lấy physical adapter, bỏ qua VPN/virtual
  const physicalMacs = getPhysicalMacs()
  if (physicalMacs.length > 0) {
    // Dùng TẤT CẢ physical MACs join lại thay vì chỉ macs[0]
    // → ổn định hơn khi thêm/bớt adapter vật lý
    identifiers.push(`MACS:${physicalMacs.join(',')}`)
  }

  // Windows MachineGuid từ registry
  try {
    const { execSync } = require('child_process')
    const winId = execSync(
      'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
      { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }
    )
    const match = winId.match(/MachineGuid\s+REG_SZ\s+([a-f0-9-]+)/i)
    if (match && match[1]) {
      identifiers.push(`WINID:${match[1]}`)
    }
  } catch {
    // Ignore — không bắt buộc
  }

  if (identifiers.length === 0) {
    return null
  }

  const unique = Array.from(new Set(identifiers)).sort()
  return unique.join('|')
}

// ─── Unix fallback ─────────────────────────────────────────────────────────

function getUnixHardwareId(): string {
  const hostname = os.hostname()
  // Trên Unix: lấy physical MAC (lọc internal), không cần lọc virtual vì ít VPN adapter hơn
  const interfaces = os.networkInterfaces()
  const macs: string[] = []
  for (const value of Object.values(interfaces)) {
    if (!value) continue
    for (const iface of value) {
      if (iface.mac && iface.mac !== '00:00:00:00:00:00' && !iface.internal) {
        macs.push(iface.mac.toLowerCase())
      }
    }
  }
  macs.sort()
  return `${hostname}|${macs.join('|')}`
}

// ─── Public API ────────────────────────────────────────────────────────────

export async function getMachineHash(): Promise<string> {
  // Ưu tiên dùng hash đã cache để tránh đổi Machine ID khi update / thay đổi driver.
  // Cache được lưu ở %APPDATA%\93MediaToolMixNhac\machine-id.txt (Windows)
  // hoặc ~/.93media/machine-id.txt (fallback).
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

  // Chuẩn hóa: bỏ khoảng trắng + uppercase
  const normalized = raw.replace(/\s+/g, '').toUpperCase()
  const hash = crypto.createHash('sha256').update(normalized).digest('hex')

  // Ghi cache — các lần chạy sau dùng luôn giá trị này
  writeCachedMachineHash(hash)
  return hash
}



