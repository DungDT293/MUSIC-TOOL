import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'crypto'
import { probeFile } from '../ffmpeg/probe'
import { saveScanResult } from './scanStore'

export interface ScannedTrack {
  id: string // unique
  path: string
  fileName: string
  folderType: 'priority' | 'random'
  duration: number // seconds
  size: number // bytes
  codec?: string
  bitrate?: number
}

export interface ScanSummary {
  priorityCount: number
  randomCount: number
  totalCount: number
  priorityDuration: number // seconds
  randomDuration: number // seconds
  totalDuration: number // seconds
}

export interface ScanMusicResult {
  tracks: ScannedTrack[]
  summary: ScanSummary
  scannedAt?: number
}

export interface ScanMusicPayload {
  priorityFolder: string | null
  randomFolder: string | null
}

const SUPPORTED_AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg']

function isSupportedAudioExtension(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase()
  return SUPPORTED_AUDIO_EXTENSIONS.includes(ext)
}

function getAllAudioFiles(dir: string): string[] {
  const files: string[] = []
  // Symlink protection: track visited realpaths để tránh vòng lặp vô tận
  const visitedDirs = new Set<string>()
  const visitedFiles = new Set<string>()

  function walkDir(currentDir: string) {
    try {
      // Resolve realpath của directory trước khi đệ quy — chống symlink loop
      let realDir: string
      try {
        realDir = fs.realpathSync(currentDir)
      } catch {
        console.warn(`[ScanMusic] Cannot resolve realpath for dir ${currentDir}, skipping`)
        return
      }
      if (visitedDirs.has(realDir)) {
        console.warn(`[ScanMusic] Symlink loop detected, skipping: ${currentDir} -> ${realDir}`)
        return
      }
      visitedDirs.add(realDir)

      const entries = fs.readdirSync(currentDir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name)

        if (entry.isDirectory()) {
          walkDir(fullPath)
        } else if (entry.isFile() && isSupportedAudioExtension(entry.name)) {
          // Resolve realpath của file — chống symlink trỏ đến cùng file
          let realFile: string
          try {
            realFile = fs.realpathSync(fullPath)
          } catch {
            console.warn(`[ScanMusic] Cannot resolve realpath for file ${fullPath}, skipping`)
            continue
          }
          if (visitedFiles.has(realFile)) {
            console.warn(`[ScanMusic] Duplicate file via symlink, skipping: ${fullPath} -> ${realFile}`)
            continue
          }
          visitedFiles.add(realFile)
          files.push(fullPath)
        }
      }
    } catch (err) {
      console.warn(`[ScanMusic] Failed to read directory ${currentDir}:`, err)
    }
  }

  walkDir(dir)
  return files
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: (R | null)[] = new Array(items.length)
  const executing: Array<{ promise: Promise<void>; index: number }> = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const index = i

    const promise = worker(item)
      .then((result) => {
        results[index] = result
      })
      .catch((err) => {
        console.warn(`[ScanMusic] Worker failed for item ${index}:`, err)
        results[index] = null
      })
      .then(() => {
        // Remove from executing when done
        const execIndex = executing.findIndex((e) => e.index === index)
        if (execIndex >= 0) {
          executing.splice(execIndex, 1)
        }
      })

    executing.push({ promise, index })

    // Wait if we've reached the limit
    if (executing.length >= limit) {
      await Promise.race(executing.map((e) => e.promise))
    }
  }

  // Wait for all remaining promises
  await Promise.all(executing.map((e) => e.promise))

  // Filter out null results
  return results.filter((r): r is R => r !== null)
}

async function scanSingleFile(
  filePath: string,
  folderType: 'priority' | 'random'
): Promise<ScannedTrack | null> {
  try {
    // Medium: check file exists trước khi probe để tránh lỗi không cần thiết
    if (!fs.existsSync(filePath)) {
      console.warn(`[ScanMusic] File not found (skip): ${filePath}`)
      return null
    }

    const probeResult = await probeFile(filePath)

    if (!probeResult.audio) {
      console.warn(`[ScanMusic] File has no audio stream: ${filePath}`)
      return null
    }

    const id = createHash('md5').update(filePath).digest('hex')
    const fileName = path.basename(filePath)
    const duration = probeResult.format.duration || 0

    // Duration filter: bỏ qua file ngắn hơn 5 giây (jingle, noise, file lỗi)
    const MIN_DURATION_SECONDS = 5
    if (duration < MIN_DURATION_SECONDS) {
      console.warn(`[ScanMusic] File too short (${duration.toFixed(2)}s < ${MIN_DURATION_SECONDS}s), skipping: ${filePath}`)
      return null
    }

    return {
      id,
      path: filePath,
      fileName,
      folderType,
      duration,
      size: probeResult.format.size || 0,
      codec: probeResult.audio.codec,
      bitrate: probeResult.format.bit_rate
        ? Math.round(probeResult.format.bit_rate / 1000)
        : undefined, // Convert to kbps
    }
  } catch (err) {
    console.warn(`[ScanMusic] Failed to probe file ${filePath}:`, err)
    return null
  }
}

export async function scanMusicFolders(
  payload: ScanMusicPayload
): Promise<ScanMusicResult> {
  const { priorityFolder, randomFolder } = payload

  if (!priorityFolder && !randomFolder) {
    throw new Error('No folders provided')
  }

  const allTracks: ScannedTrack[] = []

  // Scan priority folder
  if (priorityFolder) {
    if (!fs.existsSync(priorityFolder)) {
      throw new Error(`Priority folder does not exist: ${priorityFolder}`)
    }

    console.log(`[ScanMusic] Scanning priority folder: ${priorityFolder}`)
    const priorityFiles = getAllAudioFiles(priorityFolder)
    console.log(`[ScanMusic] priorityFiles: ${priorityFiles.length}`)

    const priorityTracks = await runWithConcurrency(
      priorityFiles,
      5, // Limit to 5 concurrent probes
      (filePath) => scanSingleFile(filePath, 'priority')
    )

    console.log(`[ScanMusic] priorityTracks scanned: ${priorityTracks.length}`)
    allTracks.push(...priorityTracks.filter((track): track is ScannedTrack => track !== null))
  }

  // Scan random folder
  if (randomFolder) {
    if (!fs.existsSync(randomFolder)) {
      throw new Error(`Random folder does not exist: ${randomFolder}`)
    }

    console.log(`[ScanMusic] Scanning random folder: ${randomFolder}`)
    const randomFiles = getAllAudioFiles(randomFolder)
    console.log(`[ScanMusic] randomFiles: ${randomFiles.length}`)

    const randomTracks = await runWithConcurrency(
      randomFiles,
      5, // Limit to 5 concurrent probes
      (filePath) => scanSingleFile(filePath, 'random')
    )

    console.log(`[ScanMusic] randomTracks scanned: ${randomTracks.length}`)
    allTracks.push(...randomTracks.filter((track): track is ScannedTrack => track !== null))
  }

  // Calculate summary
  const priorityTracks = allTracks.filter((t) => t.folderType === 'priority')
  const randomTracks = allTracks.filter((t) => t.folderType === 'random')

  console.log(`[ScanMusic] tracks total: ${allTracks.length}`)

  const summary: ScanSummary = {
    priorityCount: priorityTracks.length,
    randomCount: randomTracks.length,
    totalCount: allTracks.length,
    priorityDuration: priorityTracks.reduce((sum, t) => sum + t.duration, 0),
    randomDuration: randomTracks.reduce((sum, t) => sum + t.duration, 0),
    totalDuration: allTracks.reduce((sum, t) => sum + t.duration, 0),
  }

  const result: ScanMusicResult = {
    tracks: allTracks,
    summary,
    scannedAt: Date.now(),
  }

  saveScanResult(result)

  return result
}























