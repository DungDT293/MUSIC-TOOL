import { promisify } from 'util'
import { exec } from 'child_process'

const execAsync = promisify(exec)

export interface RealtimeStats {
  cpuPercent: number | null
  gpuPercent: number | null
  diskThroughputMBps: number | null
  diskReadMBps: number | null
  diskWriteMBps: number | null
}

async function getCpuPercentWin(): Promise<number | null> {
  try {
    const { stdout } = await execAsync(
      'wmic path Win32_PerfFormattedData_PerfOS_Processor where Name="_Total" get PercentProcessorTime /value'
    )
    const match = stdout.match(/PercentProcessorTime=(\d+)/i)
    if (!match) return null
    const v = Number(match[1])
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

interface DiskBandwidth {
  readMBps: number | null
  writeMBps: number | null
}

async function getDiskThroughputWin(): Promise<DiskBandwidth> {
  try {
    const { stdout } = await execAsync(
      'wmic path Win32_PerfFormattedData_PerfDisk_LogicalDisk where Name="C:" get DiskReadBytesPersec,DiskWriteBytesPersec /value'
    )
    const readMatch = stdout.match(/DiskReadBytesPersec=(\d+)/i)
    const writeMatch = stdout.match(/DiskWriteBytesPersec=(\d+)/i)
    const readBytes = readMatch ? Number(readMatch[1]) : null
    const writeBytes = writeMatch ? Number(writeMatch[1]) : null
    const readMBps = readBytes != null && Number.isFinite(readBytes) ? readBytes / (1024 * 1024) : null
    const writeMBps = writeBytes != null && Number.isFinite(writeBytes) ? writeBytes / (1024 * 1024) : null
    return {
      readMBps,
      writeMBps,
    }
  } catch {
    return {
      readMBps: null,
      writeMBps: null,
    }
  }
}

export async function getRealtimeStats(): Promise<RealtimeStats> {
  if (process.platform === 'win32') {
    const [cpuPercent, diskBandwidth] = await Promise.all([
      getCpuPercentWin(),
      getDiskThroughputWin(),
    ])
    const diskReadMBps = diskBandwidth.readMBps
    const diskWriteMBps = diskBandwidth.writeMBps
    const diskThroughputMBps =
      (diskReadMBps ?? 0) + (diskWriteMBps ?? 0) > 0
        ? (diskReadMBps ?? 0) + (diskWriteMBps ?? 0)
        : diskBandwidth.readMBps ?? diskBandwidth.writeMBps ?? null

    return {
      cpuPercent,
      gpuPercent: null, // Chưa đo được chính xác, để dành cho future update
      diskThroughputMBps,
      diskReadMBps,
      diskWriteMBps,
    }
  }

  // Các nền tảng khác: tạm thời không hỗ trợ
  return {
    cpuPercent: null,
    gpuPercent: null,
    diskThroughputMBps: null,
    diskReadMBps: null,
    diskWriteMBps: null,
  }
}




