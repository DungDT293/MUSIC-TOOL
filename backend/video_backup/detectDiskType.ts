/**
 * VIDEO TURBO ENGINE - Disk Type Detection
 * Phát hiện SSD/HDD để tối ưu hiệu năng
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const execAsync = promisify(exec)

export type DiskType = 'SSD' | 'HDD' | 'UNKNOWN'

export interface DiskInfo {
  type: DiskType
  mount: string
  isFast: boolean
}

/**
 * Phát hiện loại ổ đĩa (SSD/HDD) từ đường dẫn file
 */
export async function detectDiskType(filePath: string): Promise<DiskType> {
  try {
    const normalizedPath = path.resolve(filePath)
    const driveLetter = getDriveLetter(normalizedPath)
    
    if (!driveLetter) {
      return 'UNKNOWN'
    }

    if (process.platform === 'win32') {
      return await detectDiskTypeWindows(driveLetter)
    } else {
      return await detectDiskTypeUnix(normalizedPath)
    }
  } catch (error) {
    console.warn('[detectDiskType] Error:', error)
    return 'UNKNOWN'
  }
}

/**
 * Lấy ký tự ổ đĩa từ path (Windows: C:, D:, ...)
 */
function getDriveLetter(filePath: string): string | null {
  if (process.platform === 'win32') {
    const match = filePath.match(/^([A-Z]:)/i)
    return match ? match[1].toUpperCase() : null
  }
  // Unix: lấy mount point (ví dụ: /, /home, /mnt/ssd)
  const parts = filePath.split(path.sep)
  return parts.length > 1 ? path.sep + parts[1] : path.sep
}

/**
 * Phát hiện SSD/HDD trên Windows (dùng wmic)
 */
async function detectDiskTypeWindows(driveLetter: string): Promise<DiskType> {
  try {
    // Lấy physical disk ID từ logical disk
    const { stdout: diskInfo } = await execAsync(
      `wmic logicaldisk where "DeviceID='${driveLetter}'" get DeviceID,VolumeName /format:list`
    )
    
    // Lấy disk number từ partition
    const { stdout: partitionInfo } = await execAsync(
      `wmic partition where "DeviceID like '${driveLetter}%'" get DiskIndex /format:list`
    )
    
    const diskIndexMatch = partitionInfo.match(/DiskIndex=(\d+)/i)
    if (!diskIndexMatch) {
      return 'UNKNOWN'
    }
    
    const diskIndex = diskIndexMatch[1]
    
    // Kiểm tra MediaType (SSD = 4, HDD = 3)
    const { stdout: mediaType } = await execAsync(
      `wmic diskdrive where "Index=${diskIndex}" get MediaType /format:list`
    )
    
    const mediaTypeMatch = mediaType.match(/MediaType=(\d+)/i)
    if (mediaTypeMatch) {
      const type = parseInt(mediaTypeMatch[1], 10)
      // 4 = SSD, 3 = HDD, 0 = Unknown
      if (type === 4) return 'SSD'
      if (type === 3) return 'HDD'
    }
    
    // Fallback: Kiểm tra Model name (có chứa "SSD" không)
    const { stdout: modelInfo } = await execAsync(
      `wmic diskdrive where "Index=${diskIndex}" get Model /format:list`
    )
    
    const modelMatch = modelInfo.match(/Model=(.+)/i)
    if (modelMatch) {
      const model = modelMatch[1].toUpperCase()
      if (model.includes('SSD') || model.includes('SOLID STATE')) {
        return 'SSD'
      }
    }
    
    return 'HDD' // Default to HDD nếu không xác định được
  } catch (error) {
    console.warn('[detectDiskTypeWindows] Error:', error)
    // Fallback: Kiểm tra tốc độ truy cập ngẫu nhiên
    return await detectByRandomAccessSpeed(driveLetter)
  }
}

/**
 * Phát hiện SSD/HDD trên Unix (Linux/Mac)
 */
async function detectDiskTypeUnix(mountPath: string): Promise<DiskType> {
  try {
    // Dùng lsblk hoặc df để lấy device
    const { stdout } = await execAsync(`df "${mountPath}" | tail -1 | awk '{print $1}'`)
    const device = stdout.trim()
    
    if (!device) {
      return 'UNKNOWN'
    }
    
    // Kiểm tra /sys/block/.../queue/rotational
    // 0 = SSD (non-rotational), 1 = HDD (rotational)
    const deviceName = device.replace(/^\/dev\//, '').replace(/\d+$/, '')
    const rotationalPath = `/sys/block/${deviceName}/queue/rotational`
    
    if (fs.existsSync(rotationalPath)) {
      const rotational = fs.readFileSync(rotationalPath, 'utf-8').trim()
      return rotational === '0' ? 'SSD' : 'HDD'
    }
    
    // Fallback: Kiểm tra tốc độ
    return await detectByRandomAccessSpeed(mountPath)
  } catch (error) {
    console.warn('[detectDiskTypeUnix] Error:', error)
    return 'UNKNOWN'
  }
}

/**
 * Fallback: Phát hiện bằng tốc độ truy cập ngẫu nhiên
 * SSD có tốc độ truy cập ngẫu nhiên nhanh hơn HDD rất nhiều
 */
async function detectByRandomAccessSpeed(filePath: string): Promise<DiskType> {
  try {
    const testFile = path.join(path.dirname(filePath), `.turbo_test_${Date.now()}.tmp`)
    const testSize = 1024 * 1024 // 1MB
    
    // Tạo file test
    const startWrite = Date.now()
    fs.writeFileSync(testFile, Buffer.alloc(testSize))
    const writeTime = Date.now() - startWrite
    
    // Đọc file test
    const startRead = Date.now()
    fs.readFileSync(testFile)
    const readTime = Date.now() - startRead
    
    // Xóa file test
    try {
      fs.unlinkSync(testFile)
    } catch {}
    
    // SSD thường có write < 10ms, read < 5ms cho 1MB
    // HDD thường > 50ms cho cả read và write
    const avgTime = (writeTime + readTime) / 2
    return avgTime < 20 ? 'SSD' : 'HDD'
  } catch (error) {
    console.warn('[detectByRandomAccessSpeed] Error:', error)
    return 'UNKNOWN'
  }
}

/**
 * Kiểm tra ổ đĩa có phải SSD không
 */
export async function isFastDisk(filePath: string): Promise<boolean> {
  const diskType = await detectDiskType(filePath)
  return diskType === 'SSD'
}

/**
 * Lấy thông tin ổ đĩa nhanh nhất (SSD) trong hệ thống
 */
export async function getFastestSSD(): Promise<string | null> {
  try {
    if (process.platform === 'win32') {
      // Windows: Lấy tất cả ổ đĩa
      const { stdout } = await execAsync('wmic logicaldisk get DeviceID /format:list')
      const drives = stdout
        .split('\n')
        .map(line => line.match(/DeviceID=([A-Z]:)/i)?.[1])
        .filter(Boolean) as string[]
      
      // Kiểm tra từng ổ, tìm SSD đầu tiên
      for (const drive of drives) {
        const type = await detectDiskType(drive + '\\')
        if (type === 'SSD') {
          return drive + '\\'
        }
      }
      
      // Fallback: C: (thường là SSD trên máy hiện đại)
      return 'C:\\'
    } else {
      // Unix: Kiểm tra các mount point phổ biến
      const commonMounts = ['/', '/home', '/mnt', '/media']
      
      for (const mount of commonMounts) {
        if (fs.existsSync(mount)) {
          const type = await detectDiskType(mount)
          if (type === 'SSD') {
            return mount
          }
        }
      }
      
      // Fallback: root
      return '/'
    }
  } catch (error) {
    console.warn('[getFastestSSD] Error:', error)
    return process.platform === 'win32' ? 'C:\\' : '/'
  }
}

/**
 * Lấy thông tin disk cho một path
 */
export async function getDiskInfo(filePath: string): Promise<DiskInfo> {
  const type = await detectDiskType(filePath)
  const mount = getDriveLetter(filePath) || path.dirname(filePath)
  
  return {
    type,
    mount,
    isFast: type === 'SSD',
  }
}


