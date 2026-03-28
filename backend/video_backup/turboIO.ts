/**
 * VIDEO TURBO ENGINE - Turbo I/O Manager
 * Tự động sử dụng temp SSD để tăng tốc khi output trên HDD
 */

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'crypto'
import { getFastestSSD, detectDiskType, type DiskType } from './detectDiskType'

export interface TurboIOConfig {
  inputPath: string
  outputDir: string
  useTempSSD?: boolean // Force sử dụng temp SSD
  estimatedSizeBytes?: number // Ước tính kích thước output (để kiểm tra free space)
}

export interface TurboIOResult {
  actualOutputPath: string
  tempPath?: string
  finalOutputPath: string // Lưu lại final output path
  needsCopy: boolean
  diskType: DiskType
  accelerationMode: 'NONE' | 'SSD' | 'TEMP_SSD'
}

/**
 * Kiểm tra free space trên ổ đĩa (bytes)
 */
function getFreeSpace(dirPath: string): number {
  try {
    if (process.platform === 'win32') {
      // Windows: dùng fs.statSync để lấy thông tin
      // Note: Node.js không có API trực tiếp, cần dùng wmic hoặc ước tính
      // Tạm thời return một giá trị lớn (giả định đủ)
      return 100 * 1024 * 1024 * 1024 // 100GB (conservative)
    } else {
      // Unix: dùng statfs
      const stats = fs.statfsSync?.(dirPath)
      if (stats && typeof stats.bavail === 'number' && typeof stats.bsize === 'number') {
        return stats.bavail * stats.bsize
      }
      // Fallback: return conservative value
      return 100 * 1024 * 1024 * 1024 // 100GB
    }
  } catch (error) {
    console.warn('[turboIO] Failed to get free space:', error)
    // Return conservative value
    return 10 * 1024 * 1024 * 1024 // 10GB minimum
  }
}

/**
 * Tạo temp directory trên SSD
 * Kiểm tra free space trước khi tạo
 */
async function createTempSSDDir(estimatedSizeBytes?: number): Promise<string> {
  const fastestSSD = await getFastestSSD()
  if (!fastestSSD) {
    throw new Error('Không tìm thấy SSD để tạo temp directory')
  }

  // Kiểm tra free space nếu có ước tính size
  if (estimatedSizeBytes && estimatedSizeBytes > 0) {
    const freeSpace = getFreeSpace(fastestSSD)
    const requiredSpace = estimatedSizeBytes * 1.2 // Cần thêm 20% buffer
    
    if (freeSpace < requiredSpace) {
      throw new Error(
        `SSD không đủ dung lượng trống. Cần: ${(requiredSpace / (1024 * 1024 * 1024)).toFixed(2)}GB, ` +
        `Có sẵn: ${(freeSpace / (1024 * 1024 * 1024)).toFixed(2)}GB`
      )
    }
  }

  const tempBaseDir = path.join(fastestSSD, 'TurboTemp')
  
  // Tạo base temp dir nếu chưa có
  if (!fs.existsSync(tempBaseDir)) {
    fs.mkdirSync(tempBaseDir, { recursive: true })
  }

  // Tạo unique temp dir cho job này
  const tempJobDir = path.join(tempBaseDir, `video_temp_${randomUUID().substring(0, 8)}`)
  fs.mkdirSync(tempJobDir, { recursive: true })

  console.log('[turboIO] Created temp SSD dir:', tempJobDir)
  return tempJobDir
}

/**
 * Copy file từ temp SSD sang HDD cuối cùng
 * Xử lý overwrite nếu file đã tồn tại
 */
export async function copyFromTempToFinal(
  tempPath: string,
  finalPath: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  if (!fs.existsSync(tempPath)) {
    throw new Error(`Temp file không tồn tại: ${tempPath}`)
  }

  const tempStat = fs.statSync(tempPath)
  const totalSize = tempStat.size
  
  // Đảm bảo thư mục đích tồn tại
  const finalDir = path.dirname(finalPath)
  if (!fs.existsSync(finalDir)) {
    fs.mkdirSync(finalDir, { recursive: true })
  }

  // Xóa file đích nếu đã tồn tại (overwrite)
  if (fs.existsSync(finalPath)) {
    try {
      fs.unlinkSync(finalPath)
    } catch (error) {
      console.warn('[turboIO] Failed to delete existing file:', finalPath, error)
    }
  }

  let copiedSize = 0

  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(tempPath)
    const writeStream = fs.createWriteStream(finalPath, { flags: 'w' }) // Force overwrite

    readStream.on('data', (chunk: Buffer) => {
      copiedSize += chunk.length
      if (onProgress && totalSize > 0) {
        const percent = Math.min(100, (copiedSize / totalSize) * 100)
        onProgress(percent)
      }
    })

    readStream.on('error', (error) => {
      writeStream.destroy()
      reject(error)
    })
    
    writeStream.on('error', (error) => {
      readStream.destroy()
      reject(error)
    })
    
    writeStream.on('finish', () => {
      resolve()
    })

    readStream.pipe(writeStream)
  })
}

/**
 * Copy directory từ temp SSD sang HDD
 */
export async function copyDirectoryFromTempToFinal(
  tempDir: string,
  finalDir: string,
  onProgress?: (fileIndex: number, totalFiles: number) => void
): Promise<void> {
  // Đảm bảo final dir tồn tại
  if (!fs.existsSync(finalDir)) {
    fs.mkdirSync(finalDir, { recursive: true })
  }

  // Đọc tất cả files trong temp dir
  const files = fs.readdirSync(tempDir, { withFileTypes: true })
  const fileCount = files.length

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const sourcePath = path.join(tempDir, file.name)
    const destPath = path.join(finalDir, file.name)

    if (file.isFile()) {
      await copyFromTempToFinal(sourcePath, destPath)
    } else if (file.isDirectory()) {
      // Recursive copy subdirectory
      await copyDirectoryFromTempToFinal(sourcePath, destPath)
    }

    if (onProgress) {
      onProgress(i + 1, fileCount)
    }
  }
}

/**
 * Xóa temp directory và tất cả nội dung
 */
export async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    if (fs.existsSync(tempDir)) {
      // Xóa recursive
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  } catch (error) {
    console.warn('[turboIO] Failed to cleanup temp dir:', tempDir, error)
    // Không throw, chỉ log warning
  }
}

/**
 * Quyết định có nên dùng temp SSD không
 */
export async function shouldUseTempSSD(config: TurboIOConfig): Promise<boolean> {
  // Force mode
  if (config.useTempSSD === true) {
    return true
  }
  if (config.useTempSSD === false) {
    return false
  }

  // Auto-detect: Kiểm tra output dir có phải HDD không
  const outputDiskType = await detectDiskType(config.outputDir)
  
  // Nếu output trên HDD → dùng temp SSD
  if (outputDiskType === 'HDD') {
    return true
  }

  // Nếu output trên SSD → không cần temp
  return false
}

/**
 * Setup Turbo I/O: Quyết định output path (temp SSD hoặc trực tiếp)
 */
export async function setupTurboIO(config: TurboIOConfig): Promise<TurboIOResult> {
  const outputDiskType = await detectDiskType(config.outputDir)
  const inputDiskType = await detectDiskType(config.inputPath)

  // Case 1: Output trên SSD → dùng trực tiếp
  if (outputDiskType === 'SSD') {
    return {
      actualOutputPath: config.outputDir,
      finalOutputPath: config.outputDir, // Lưu lại final path
      needsCopy: false,
      diskType: 'SSD',
      accelerationMode: 'SSD',
    }
  }

  // Case 2: Output trên HDD → dùng temp SSD
  const useTemp = await shouldUseTempSSD(config)
  
  if (useTemp) {
    try {
      const tempDir = await createTempSSDDir(config.estimatedSizeBytes)
      
      return {
        actualOutputPath: tempDir, // Output tạm vào temp SSD
        tempPath: tempDir,
        finalOutputPath: config.outputDir, // Lưu lại final path
        needsCopy: true, // Cần copy về HDD sau khi xong
        diskType: 'HDD',
        accelerationMode: 'TEMP_SSD',
      }
    } catch (error) {
      console.warn('[turboIO] Failed to create temp SSD dir, falling back to direct HDD:', error)
      // Fallback: output trực tiếp HDD nếu không tạo được temp
      return {
        actualOutputPath: config.outputDir,
        finalOutputPath: config.outputDir,
        needsCopy: false,
        diskType: 'HDD',
        accelerationMode: 'NONE',
      }
    }
  }

  // Case 3: Không dùng temp (user tắt) → output trực tiếp HDD
  return {
    actualOutputPath: config.outputDir,
    finalOutputPath: config.outputDir,
    needsCopy: false,
    diskType: 'HDD',
    accelerationMode: 'NONE',
  }
}

/**
 * Finalize Turbo I/O: Copy từ temp SSD sang HDD nếu cần
 * Sử dụng finalOutputPath từ result nếu có, nếu không dùng finalOutputDir
 */
export async function finalizeTurboIO(
  result: TurboIOResult,
  finalOutputDir?: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  if (!result.needsCopy || !result.tempPath) {
    return // Không cần copy
  }

  // Ưu tiên dùng finalOutputPath từ result, fallback về finalOutputDir
  const targetDir = result.finalOutputPath || finalOutputDir
  if (!targetDir) {
    console.error('[turboIO] No target directory specified for finalize')
    // Vẫn cleanup temp dù không copy được
    await cleanupTempDir(result.tempPath)
    return
  }

  console.log('[turboIO] Copying from temp SSD to HDD:', result.tempPath, '→', targetDir)

  try {
    // Copy toàn bộ directory
    await copyDirectoryFromTempToFinal(result.tempPath, targetDir, (fileIndex, totalFiles) => {
      if (onProgress) {
        const percent = Math.min(100, (fileIndex / totalFiles) * 100)
        onProgress(percent)
      }
    })

    // Cleanup temp sau khi copy thành công
    await cleanupTempDir(result.tempPath)
    
    console.log('[turboIO] Copy completed and temp cleaned up')
  } catch (error) {
    console.error('[turboIO] Failed to copy from temp to final:', error)
    // Vẫn cleanup temp dù copy fail (tránh leak disk space)
    try {
      await cleanupTempDir(result.tempPath)
    } catch (cleanupError) {
      console.error('[turboIO] Failed to cleanup temp after copy error:', cleanupError)
    }
    throw error // Re-throw để caller biết copy fail
  }
}

