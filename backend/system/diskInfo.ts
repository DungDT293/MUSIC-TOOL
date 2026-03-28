import { promisify } from 'util'
import { exec } from 'child_process'

const execAsync = promisify(exec)

// Timeout cho các lệnh WMIC (5 giây)
const WMIC_TIMEOUT_MS = 5000

/**
 * Wrapper cho execAsync với timeout
 */
async function execWithTimeout(command: string, timeoutMs: number = WMIC_TIMEOUT_MS): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = exec(command, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        // Nếu timeout, không reject mà trả về empty
        if (error.signal === 'SIGTERM') {
          resolve({ stdout: '', stderr: 'Timeout' })
        } else {
          reject(error)
        }
      } else {
        resolve({ stdout, stderr })
      }
    })
  })
}

export type DiskType = 'SSD' | 'HDD' | 'UNKNOWN'

export interface DiskDriveInfo {
  drive: string
  totalBytes: number | null
  freeBytes: number | null
  usedBytes: number | null
  usedPercent: number | null
  diskType?: DiskType
}

export interface DiskTypeSummary {
  type: DiskType
  totalBytes: number
  freeBytes: number
  usedBytes: number
  driveCount: number
}

export interface DiskInfoSummary {
  drives: DiskDriveInfo[]
  byType: {
    ssd: DiskTypeSummary | null
    hdd: DiskTypeSummary | null
  }
  updatedAt: number
}

/**
 * Phát hiện loại ổ đĩa (SSD/HDD) cho một drive letter trên Windows
 * Với timeout để tránh chờ quá lâu
 */
async function detectDiskTypeWindows(driveLetter: string): Promise<DiskType> {
  try {
    // Method 1: Try partition query with escaped backslash
    let diskIndexMatch: RegExpMatchArray | null = null
    let diskIndex: string | null = null
    
    try {
      const { stdout: partitionInfo } = await execWithTimeout(
        `wmic partition where "DeviceID='${driveLetter}\\\\'" get DiskIndex /format:list`,
        3000 // 3 giây timeout
      )
      
      diskIndexMatch = partitionInfo.match(/DiskIndex=(\d+)/i)
      if (diskIndexMatch) {
        diskIndex = diskIndexMatch[1]
        console.log(`[system] detectDiskTypeWindows: ${driveLetter} found DiskIndex=${diskIndex} via partition query`)
      }
    } catch (err) {
      console.log(`[system] detectDiskTypeWindows: ${driveLetter} partition query failed, trying alternative method...`)
    }
    
    // Method 2: If partition query fails, try alternative query format
    if (!diskIndexMatch) {
      try {
        const { stdout: partitionInfo2 } = await execWithTimeout(
          `wmic partition where "DeviceID like '${driveLetter}%'" get DiskIndex /format:list`,
          3000
        )
        
        diskIndexMatch = partitionInfo2.match(/DiskIndex=(\d+)/i)
        if (diskIndexMatch) {
          diskIndex = diskIndexMatch[1]
          console.log(`[system] detectDiskTypeWindows: ${driveLetter} found DiskIndex=${diskIndex} via alternative partition query`)
        }
      } catch (err) {
        console.log(`[system] detectDiskTypeWindows: ${driveLetter} alternative partition query also failed`)
      }
    }
    
    // Method 3: If still no DiskIndex, try logicaldisk -> diskdrive mapping
    if (!diskIndexMatch) {
      try {
        // Get volume serial number or other identifier from logicaldisk
        const { stdout: logicalDiskInfo } = await execWithTimeout(
          `wmic logicaldisk where "DeviceID='${driveLetter}'" get VolumeSerialNumber,Size /format:list`,
          2000
        )
        
        // Try to enumerate all diskdrives and match by size
        const { stdout: diskDriveInfo } = await execWithTimeout(
          `wmic diskdrive get Index,Model,Size /format:list`,
          3000
        )
        
        // Parse diskdrive info and try to match (complex, skip for now)
        console.log(`[system] detectDiskTypeWindows: ${driveLetter} trying diskdrive enumeration...`)
      } catch (err) {
        console.log(`[system] detectDiskTypeWindows: ${driveLetter} diskdrive enumeration failed`)
      }
    }
    
    // Fallback: If C: drive and all methods failed, assume SSD (common case)
    if (!diskIndexMatch && driveLetter === 'C:') {
      console.log(`[system] detectDiskTypeWindows: ${driveLetter} is C: drive, assuming SSD (common case on modern systems)`)
      return 'SSD'
    }
    
    if (!diskIndexMatch) {
      console.log(`[system] detectDiskTypeWindows: No DiskIndex found for ${driveLetter} after all methods, defaulting to HDD`)
      return 'HDD' // Default to HDD nếu không tìm được partition
    }
    
    diskIndex = diskIndexMatch[1]
    
    // Kiểm tra MediaType (SSD = 4, HDD = 3) với timeout
    try {
      const { stdout: mediaType } = await execWithTimeout(
        `wmic diskdrive where "Index=${diskIndex}" get MediaType /format:list`,
        2000 // 2 giây timeout
      )
      
      const mediaTypeMatch = mediaType.match(/MediaType=(\d+)/i)
      if (mediaTypeMatch) {
        const type = parseInt(mediaTypeMatch[1], 10)
        // 4 = SSD, 3 = HDD, 0 = Unknown
        if (type === 4) {
          console.log(`[system] detectDiskTypeWindows: ${driveLetter} detected as SSD (MediaType=4)`)
          return 'SSD'
        }
        if (type === 3) {
          console.log(`[system] detectDiskTypeWindows: ${driveLetter} detected as HDD (MediaType=3)`)
          return 'HDD'
        }
        // Nếu MediaType = 0 hoặc giá trị khác, tiếp tục kiểm tra Model
        console.log(`[system] detectDiskTypeWindows: ${driveLetter} MediaType=${type}, checking Model...`)
      } else {
        console.log(`[system] detectDiskTypeWindows: ${driveLetter} MediaType not found, checking Model...`)
      }
    } catch (err) {
      console.log(`[system] detectDiskTypeWindows: ${driveLetter} MediaType check failed, checking Model...`)
    }
    
    // Fallback: Kiểm tra Model name với timeout
    try {
      const { stdout: modelInfo } = await execWithTimeout(
        `wmic diskdrive where "Index=${diskIndex}" get Model /format:list`,
        2000 // 2 giây timeout
      )
      
      const modelMatch = modelInfo.match(/Model=(.+)/i)
      if (modelMatch) {
        const model = modelMatch[1].toUpperCase()
        if (model.includes('SSD') || model.includes('SOLID STATE')) {
          console.log(`[system] detectDiskTypeWindows: ${driveLetter} detected as SSD (Model contains SSD)`)
          return 'SSD'
        }
        // Nếu Model không chứa SSD, có thể là HDD
        console.log(`[system] detectDiskTypeWindows: ${driveLetter} Model="${modelMatch[1]}", defaulting to HDD`)
      }
    } catch (err) {
      console.log(`[system] detectDiskTypeWindows: ${driveLetter} Model check failed, defaulting to HDD`)
    }
    
    // Mặc định là HDD nếu không phát hiện được SSD
    console.log(`[system] detectDiskTypeWindows: ${driveLetter} defaulting to HDD`)
    return 'HDD'
  } catch (error) {
    console.log(`[system] detectDiskTypeWindows: ${driveLetter} error, defaulting to HDD:`, error)
    return 'HDD' // Default to HDD thay vì UNKNOWN
  }
}

async function getDiskInfoWindows(): Promise<DiskDriveInfo[]> {
  try {
    // Lấy thông tin cơ bản với timeout - thử cả DriveType=3 và không filter
    const { stdout } = await execWithTimeout(
      'wmic logicaldisk get DeviceID,FreeSpace,Size,DriveType /format:list',
      5000 // 5 giây timeout
    )
    
    console.log(`[system] WMIC raw output length: ${stdout.length} chars`)
    
    // Parse output - WMIC format:list trả về các dòng Key=Value
    // Các block cách nhau bởi dòng trống
    // Parse từng dòng và nhóm lại theo DeviceID
    const lines = stdout.split(/\r?\n/)
    const drivesMap = new Map<string, { drive: string; freeStr?: string; sizeStr?: string; driveType?: string }>()
    let currentDrive = ''
    
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) {
        // Dòng trống - reset current drive
        currentDrive = ''
        continue
      }
      
      const [keyRaw, valueRaw] = trimmed.split('=')
      if (!keyRaw || !valueRaw) continue
      
      const key = keyRaw.trim().toLowerCase()
      const value = valueRaw.trim()
      
      if (key === 'deviceid') {
        currentDrive = value
        if (!drivesMap.has(currentDrive)) {
          drivesMap.set(currentDrive, { drive: currentDrive })
        }
      } else if (currentDrive && drivesMap.has(currentDrive)) {
        const driveInfo = drivesMap.get(currentDrive)!
        if (key === 'freespace') {
          driveInfo.freeStr = value
        } else if (key === 'size') {
          driveInfo.sizeStr = value
        } else if (key === 'drivetype') {
          driveInfo.driveType = value
        }
      }
    }
    
    const blocks = Array.from(drivesMap.values())
    console.log(`[system] Found ${blocks.length} drives after parsing:`, blocks.map(b => b.drive).join(', '))

    const drives: DiskDriveInfo[] = []
    
    // Bước 1: Thu thập thông tin cơ bản của tất cả ổ đĩa trước
    const drivePromises: Array<Promise<DiskDriveInfo>> = []
    
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]
      const drive = block.drive
      const freeStr = block.freeStr
      const sizeStr = block.sizeStr
      const driveType = block.driveType

      // Chỉ lấy Fixed disk (DriveType=3) hoặc nếu không có DriveType thì lấy tất cả
      if (!drive) {
        console.log(`[system] Block ${i} has no DeviceID, skipping`)
        continue
      }
      
      // Bỏ qua CD-ROM (DriveType=5), Removable (DriveType=2), Network (DriveType=4)
      if (driveType && driveType !== '3') {
        console.log(`[system] Drive ${drive} has DriveType=${driveType}, skipping (only DriveType=3 is Fixed disk)`)
        continue
      }
      
      console.log(`[system] Processing drive ${drive}: FreeSpace=${freeStr}, Size=${sizeStr}, DriveType=${driveType}`)
      const totalBytes = sizeStr ? Number(sizeStr) : null
      const freeBytes = freeStr ? Number(freeStr) : null
      const usedBytes =
        totalBytes != null && freeBytes != null ? Math.max(totalBytes - freeBytes, 0) : null
      const usedPercent =
        totalBytes && usedBytes != null && totalBytes > 0
          ? (usedBytes / totalBytes) * 100
          : null

      // Tạo promise để phát hiện loại ổ đĩa song song
      const drivePromise = (async () => {
        // Phát hiện loại ổ đĩa với timeout ngắn (mặc định là HDD nếu timeout)
        const diskType = await Promise.race([
          detectDiskTypeWindows(drive),
          new Promise<DiskType>((resolve) => setTimeout(() => resolve('HDD'), 5000))
        ])

        return {
          drive,
          totalBytes: Number.isFinite(totalBytes as number) ? totalBytes : null,
          freeBytes: Number.isFinite(freeBytes as number) ? freeBytes : null,
          usedBytes: Number.isFinite(usedBytes as number) ? usedBytes : null,
          usedPercent: Number.isFinite(usedPercent as number) ? usedPercent : null,
          diskType,
        }
      })()

      drivePromises.push(drivePromise)
    }

    // Chờ tất cả các promise hoàn thành (song song)
    const results = await Promise.allSettled(drivePromises)
    
    for (const result of results) {
      if (result.status === 'fulfilled') {
        drives.push(result.value)
      }
    }

    return drives
  } catch (error) {
    console.error('[system] getDiskInfoWindows error:', error)
    return []
  }
}

export async function getDiskInfo(): Promise<DiskInfoSummary> {
  let drives: DiskDriveInfo[] = []

  try {
    if (process.platform === 'win32') {
      const startTime = Date.now()
      drives = await getDiskInfoWindows()
      const duration = Date.now() - startTime
      console.log(`[system] getDiskInfo completed in ${duration}ms, found ${drives.length} drives`)
    } else {
      // Các hệ điều hành khác hiện chưa hỗ trợ chi tiết, trả về rỗng
      drives = []
    }
  } catch (error) {
    console.error('[system] getDiskInfo error:', error)
    drives = []
  }

  // Tính tổng dung lượng theo loại (SSD/HDD)
  let ssdTotal = 0
  let ssdFree = 0
  let ssdCount = 0
  let hddTotal = 0
  let hddFree = 0
  let hddCount = 0
  let unknownCount = 0

  for (const drive of drives) {
    console.log(`[system] Processing drive ${drive.drive}: type=${drive.diskType}, total=${drive.totalBytes}, free=${drive.freeBytes}`)
    
    if (drive.diskType === 'SSD' && drive.totalBytes != null && drive.freeBytes != null) {
      ssdTotal += drive.totalBytes
      ssdFree += drive.freeBytes
      ssdCount++
    } else if ((drive.diskType === 'HDD' || drive.diskType === 'UNKNOWN') && drive.totalBytes != null && drive.freeBytes != null) {
      // Nếu là HDD hoặc UNKNOWN, tính vào HDD
      hddTotal += drive.totalBytes
      hddFree += drive.freeBytes
      hddCount++
      if (drive.diskType === 'UNKNOWN') {
        unknownCount++
        console.log(`[system] Drive ${drive.drive} is UNKNOWN, counting as HDD`)
      }
    }
  }
  
  const formatGB = (bytes: number) => {
    if (!Number.isFinite(bytes)) return '0 GB'
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }
  console.log(`[system] Summary: SSD=${ssdCount} drives (${formatGB(ssdTotal)}), HDD=${hddCount} drives (${formatGB(hddTotal)}), Unknown=${unknownCount}`)

  const ssdSummary: DiskTypeSummary | null =
    ssdCount > 0
      ? {
          type: 'SSD',
          totalBytes: ssdTotal,
          freeBytes: ssdFree,
          usedBytes: Math.max(ssdTotal - ssdFree, 0),
          driveCount: ssdCount,
        }
      : null

  const hddSummary: DiskTypeSummary | null =
    hddCount > 0
      ? {
          type: 'HDD',
          totalBytes: hddTotal,
          freeBytes: hddFree,
          usedBytes: Math.max(hddTotal - hddFree, 0),
          driveCount: hddCount,
        }
      : null

  return {
    drives,
    byType: {
      ssd: ssdSummary,
      hdd: hddSummary,
    },
    updatedAt: Date.now(),
  }
}


