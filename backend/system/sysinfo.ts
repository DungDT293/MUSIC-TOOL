import os from 'node:os'
import { exec } from 'child_process'
import { promisify } from 'util'
import { runFfprobe } from '../ffmpeg/wrapper'

const execAsync = promisify(exec)

export interface SystemInfo {
  cpuModel: string
  cpuCores: number
  gpuModel?: string
  ramGB: number
  drives: Array<{
    mount: string
    totalGB: number
    freeGB: number
  }>
  ffmpegVersion?: string
}

async function getGpuModel(): Promise<string | undefined> {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execAsync('wmic path win32_VideoController get name')
      const lines = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && line !== 'Name' && !line.startsWith('---'))
      return lines[0] || undefined
    } catch {
      return undefined
    }
  }
  // Linux/Mac: đơn giản trả undefined
  return undefined
}

async function getDrives(): Promise<Array<{ mount: string; totalGB: number; freeGB: number }>> {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execAsync('wmic logicaldisk get name,size,freespace /format:list')
      const drives: Array<{ mount: string; totalGB: number; freeGB: number }> = []
      const entries = stdout.split(/\r?\n\r?\n/).filter((entry) => entry.trim())

      for (const entry of entries) {
        const nameMatch = entry.match(/Name=([A-Z]:)/i)
        const sizeMatch = entry.match(/Size=(\d+)/i)
        const freeMatch = entry.match(/FreeSpace=(\d+)/i)

        if (nameMatch && sizeMatch && freeMatch) {
          const mount = nameMatch[1]
          const size = parseInt(sizeMatch[1], 10)
          const free = parseInt(freeMatch[1], 10)

          if (!isNaN(size) && !isNaN(free)) {
            drives.push({
              mount,
              totalGB: Math.round((size / 1024 / 1024 / 1024) * 100) / 100,
              freeGB: Math.round((free / 1024 / 1024 / 1024) * 100) / 100,
            })
          }
        }
      }

      return drives
    } catch {
      return []
    }
  } else {
    // Linux/Mac: dùng df -k
    try {
      const { stdout } = await execAsync('df -k')
      const lines = stdout.split('\n').slice(1) // Bỏ header
      const drives: Array<{ mount: string; totalGB: number; freeGB: number }> = []

      for (const line of lines) {
        const parts = line.trim().split(/\s+/)
        if (parts.length >= 4) {
          const mount = parts[parts.length - 1]
          const totalKB = parseInt(parts[1], 10)
          const freeKB = parseInt(parts[3], 10)

          if (!isNaN(totalKB) && !isNaN(freeKB) && mount.startsWith('/')) {
            drives.push({
              mount,
              totalGB: Math.round((totalKB / 1024 / 1024) * 100) / 100,
              freeGB: Math.round((freeKB / 1024 / 1024) * 100) / 100,
            })
          }
        }
      }

      return drives
    } catch {
      return []
    }
  }
}

async function getFfmpegVersion(): Promise<string | undefined> {
  try {
    const versionOutput = await runFfprobe(['-version'])
    const firstLine = versionOutput.split(/\r?\n/)[0]
    return firstLine || undefined
  } catch {
    return undefined
  }
}

export async function getSystemInfo(): Promise<SystemInfo> {
  const cpus = os.cpus()
  const cpuModel = cpus[0]?.model || 'Unknown CPU'
  const cpuCores = cpus.length
  const ramGB = Math.round((os.totalmem() / 1024 / 1024 / 1024) * 100) / 100

  const [gpuModel, drives, ffmpegVersion] = await Promise.all([
    getGpuModel(),
    getDrives(),
    getFfmpegVersion(),
  ])

  return {
    cpuModel,
    cpuCores,
    gpuModel,
    ramGB,
    drives,
    ffmpegVersion,
  }
}









