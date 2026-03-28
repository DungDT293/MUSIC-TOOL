/**
 * Ultra Fast Video File Scanner
 * Phase 1: Instant scan (no probe)
 * Phase 2: Lazy metadata (on-demand)
 */

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'crypto'
import { getVideoFileInfo, type VideoFileInfo } from './videoInfo'

export interface SimpleVideoFileEntry {
  path: string
  fileName: string
  sizeBytes: number
  mtimeMs: number
}

export interface SimpleVideoFile {
  id: string // Hash của path
  path: string // Full path
  fileName: string // Tên file
  sizeBytes: number // Size (từ fs.stat)
  mtimeMs: number // Modified time (từ fs.stat)
  extension: string // .mp4, .mkv, etc.
}

const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mkv',
  '.mov',
  '.avi',
  '.wmv',
  '.flv',
  '.webm',
  '.m4v',
  '.mpg',
  '.mpeg',
  '.3gp',
])

/**
 * Hash path để tạo unique ID
 */
function hashPath(filePath: string): string {
  return createHash('md5').update(filePath).digest('hex').substring(0, 16)
}

/**
 * PHASE 1: Ultra Fast Scan - NO PROBE
 * Quét 10,000 files trong < 1 giây (recursive)
 */
export async function ultraFastScanFolder(folderPath: string): Promise<SimpleVideoFile[]> {
  console.time('[ULTRA-SCAN] Total time')

  const results: SimpleVideoFile[] = []

  try {
    // Đệ quy quét tất cả files
    await scanRecursive(folderPath, results)

    console.timeEnd('[ULTRA-SCAN] Total time')
    console.log(`[ULTRA-SCAN] Found ${results.length} videos`)

    return results
  } catch (error) {
    console.error('[ULTRA-SCAN] Error:', error)
    throw error
  }
}

/**
 * Recursive scan - KHÔNG probe metadata
 */
async function scanRecursive(dirPath: string, results: SimpleVideoFile[]): Promise<void> {
  let entries: fs.Dirent[]

  try {
    // fs.readdir với withFileTypes = true (nhanh hơn)
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
  } catch (error) {
    console.warn(`[ULTRA-SCAN] Cannot read dir: ${dirPath}`)
    return
  }

  // Process entries
  const tasks: Promise<void>[] = []

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)

    if (entry.isDirectory()) {
      // Đệ quy vào subfolder
      tasks.push(scanRecursive(fullPath, results))
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()

      if (VIDEO_EXTENSIONS.has(ext)) {
        // Chỉ fs.stat, KHÔNG probe
        tasks.push(
          (async () => {
            try {
              const stat = await fs.promises.stat(fullPath)

              results.push({
                id: hashPath(fullPath),
                path: fullPath,
                fileName: entry.name,
                sizeBytes: stat.size,
                mtimeMs: stat.mtimeMs,
                extension: ext,
              })
            } catch (err) {
              // Skip file nếu không đọc được stat
            }
          })()
        )
      }
    }
  }

  // Chạy tất cả tasks song song
  await Promise.all(tasks)
}

/**
 * PHASE 2: Lazy Probe - chỉ probe khi cần
 */
export async function lazyProbeVideo(videoPath: string): Promise<VideoFileInfo | null> {
  try {
    const metadata = await getVideoFileInfo(videoPath)
    return metadata
  } catch (error) {
    console.warn(`[LAZY-PROBE] Failed: ${videoPath}`, error)
    return null
  }
}

/**
 * Batch Lazy Probe - probe nhiều files cùng lúc
 */
export async function batchLazyProbe(
  videoPaths: string[],
  concurrency: number = 5
): Promise<Map<string, VideoFileInfo | null>> {
  const results = new Map<string, VideoFileInfo | null>()

  // Simple concurrency limiter (không dùng p-limit)
  const activeTasks = new Set<Promise<void>>()
  const queue = [...videoPaths]

  const processNext = async () => {
    if (queue.length === 0) return

    const path = queue.shift()
    if (!path) return

    const taskPromise = (async () => {
      const metadata = await lazyProbeVideo(path)
      results.set(path, metadata)
    })()

    activeTasks.add(taskPromise)

    taskPromise
      .finally(() => {
        activeTasks.delete(taskPromise)
        if (queue.length > 0 && activeTasks.size < concurrency) {
          processNext()
        }
      })
      .catch(() => {
        // Errors handled in lazyProbeVideo
      })
  }

  // Start processing
  const initialBatch = Math.min(concurrency, queue.length)
  for (let i = 0; i < initialBatch; i++) {
    processNext()
  }

  // Wait for all tasks
  while (activeTasks.size > 0 || queue.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  return results
}

/**
 * Legacy function - giữ tương thích
 * Chỉ scan 1 level (không recursive)
 */
export function listVideoFilesSimple(dir: string): SimpleVideoFileEntry[] {
  const files: SimpleVideoFileEntry[] = []

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isFile()) continue

      const ext = path.extname(entry.name).toLowerCase()
      if (!VIDEO_EXTENSIONS.has(ext)) continue

      const fullPath = path.join(dir, entry.name)

      try {
        const stat = fs.statSync(fullPath)
        files.push({
          path: fullPath,
          fileName: entry.name,
          sizeBytes: stat.size,
          mtimeMs: stat.mtimeMs,
        })
      } catch (err) {
        // Bỏ qua file không đọc được stat
        console.warn(`[listVideoFilesSimple] Cannot stat file: ${fullPath}`, err)
      }
    }
  } catch (err) {
    console.error(`[listVideoFilesSimple] Error reading directory: ${dir}`, err)
    throw err
  }

  return files
}
