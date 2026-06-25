import fs from 'node:fs'
import fsp from 'node:fs/promises'
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
  /** Các file audio KHÔNG phải chuẩn AAC (.m4a / .aac). Cần chuẩn hóa. */
  nonAacFiles?: string[]
}

export interface ScanMusicPayload {
  priorityFolder: string | null
  randomFolder: string | null
}

export interface ScanMusicProgress {
  phase: 'discover' | 'probe'
  folderType: 'priority' | 'random'
  currentPath: string
  directoriesScanned?: number
  filesDiscovered?: number
  filesProcessed?: number
  totalFiles?: number
}

export interface ScanMusicOptions {
  signal?: AbortSignal
  onProgress?: (progress: ScanMusicProgress) => void
}

const SUPPORTED_AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg']
const AAC_EXTENSIONS = new Set(['.m4a', '.aac'])
const DISCOVER_PROGRESS_STEP = 25
const DISCOVER_YIELD_EVERY_DIRS = 25

function isSupportedAudioExtension(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase()
  return SUPPORTED_AUDIO_EXTENSIONS.includes(ext)
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('Music scan was cancelled.')
  ;(error as Error & { code?: string }).code = 'ABORT_ERR'
  throw error
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function getAllAudioFiles(
  dir: string,
  folderType: 'priority' | 'random',
  options: ScanMusicOptions = {},
): Promise<string[]> {
  const files: string[] = []
  const visitedDirs = new Set<string>()
  const visitedFiles = new Set<string>()
  const stack: string[] = [dir]
  let directoriesScanned = 0

  while (stack.length > 0) {
    throwIfAborted(options.signal)
    const currentDir = stack.pop()!

    let realDir: string
    try {
      realDir = await fsp.realpath(currentDir)
    } catch {
      console.warn(`[ScanMusic] Cannot resolve realpath for dir ${currentDir}, skipping`)
      continue
    }

    if (visitedDirs.has(realDir)) {
      console.warn(`[ScanMusic] Symlink loop detected, skipping: ${currentDir} -> ${realDir}`)
      continue
    }
    visitedDirs.add(realDir)

    let entries: fs.Dirent[]
    try {
      entries = await fsp.readdir(currentDir, { withFileTypes: true })
    } catch (err) {
      console.warn(`[ScanMusic] Failed to read directory ${currentDir}:`, err)
      continue
    }

    directoriesScanned++
    options.onProgress?.({
      phase: 'discover',
      folderType,
      currentPath: currentDir,
      directoriesScanned,
      filesDiscovered: files.length,
    })

    for (const entry of entries) {
      throwIfAborted(options.signal)
      const fullPath = path.join(currentDir, entry.name)

      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }

      if (!entry.isFile() || !isSupportedAudioExtension(entry.name)) {
        continue
      }

      let realFile: string
      try {
        realFile = await fsp.realpath(fullPath)
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

      if (files.length === 1 || files.length % DISCOVER_PROGRESS_STEP === 0) {
        options.onProgress?.({
          phase: 'discover',
          folderType,
          currentPath: fullPath,
          directoriesScanned,
          filesDiscovered: files.length,
        })
      }
    }

    if (directoriesScanned % DISCOVER_YIELD_EVERY_DIRS === 0) {
      await yieldToEventLoop()
    }
  }

  return files
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
  options: {
    signal?: AbortSignal
    onItemCompleted?: (completed: number, total: number, item: T) => void
  } = {},
): Promise<R[]> {
  if (items.length === 0) return []

  const results: (R | null)[] = new Array(items.length).fill(null)
  const workerCount = Math.max(1, Math.min(limit, items.length))
  let nextIndex = 0
  let completed = 0

  const workerLoop = async () => {
    while (true) {
      throwIfAborted(options.signal)
      const currentIndex = nextIndex++
      if (currentIndex >= items.length) return

      const item = items[currentIndex]
      try {
        results[currentIndex] = await worker(item)
      } catch (err) {
        console.warn(`[ScanMusic] Worker failed for item ${currentIndex}:`, err)
        results[currentIndex] = null
      }

      completed++
      options.onItemCompleted?.(completed, items.length, item)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => workerLoop()))
  return results.filter((result): result is R => result !== null)
}

async function scanSingleFile(
  filePath: string,
  folderType: 'priority' | 'random',
): Promise<ScannedTrack | null> {
  try {
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
    const minDurationSeconds = 5

    if (duration < minDurationSeconds) {
      console.warn(
        `[ScanMusic] File too short (${duration.toFixed(2)}s < ${minDurationSeconds}s), skipping: ${filePath}`,
      )
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
      bitrate: probeResult.format.bit_rate ? Math.round(probeResult.format.bit_rate / 1000) : undefined,
    }
  } catch (err) {
    console.warn(`[ScanMusic] Failed to probe file ${filePath}:`, err)
    return null
  }
}

export async function scanMusicFolders(
  payload: ScanMusicPayload,
  options: ScanMusicOptions = {},
): Promise<ScanMusicResult> {
  const { priorityFolder, randomFolder } = payload

  if (!priorityFolder && !randomFolder) {
    throw new Error('No folders provided')
  }

  const allTracks: ScannedTrack[] = []
  throwIfAborted(options.signal)

  if (priorityFolder) {
    if (!fs.existsSync(priorityFolder)) {
      throw new Error(`Priority folder does not exist: ${priorityFolder}`)
    }

    console.log(`[ScanMusic] Scanning priority folder: ${priorityFolder}`)
    const priorityFiles = await getAllAudioFiles(priorityFolder, 'priority', options)
    console.log(`[ScanMusic] priorityFiles: ${priorityFiles.length}`)

    const priorityTracks = await runWithConcurrency(
      priorityFiles,
      5,
      (filePath) => scanSingleFile(filePath, 'priority'),
      {
        signal: options.signal,
        onItemCompleted: (completed, total, item) => {
          options.onProgress?.({
            phase: 'probe',
            folderType: 'priority',
            currentPath: item,
            filesDiscovered: total,
            filesProcessed: completed,
            totalFiles: total,
          })
        },
      },
    )

    console.log(`[ScanMusic] priorityTracks scanned: ${priorityTracks.length}`)
    allTracks.push(...priorityTracks.filter((track): track is ScannedTrack => track !== null))
  }

  throwIfAborted(options.signal)

  if (randomFolder) {
    if (!fs.existsSync(randomFolder)) {
      throw new Error(`Random folder does not exist: ${randomFolder}`)
    }

    console.log(`[ScanMusic] Scanning random folder: ${randomFolder}`)
    const randomFiles = await getAllAudioFiles(randomFolder, 'random', options)
    console.log(`[ScanMusic] randomFiles: ${randomFiles.length}`)

    const randomTracks = await runWithConcurrency(
      randomFiles,
      5,
      (filePath) => scanSingleFile(filePath, 'random'),
      {
        signal: options.signal,
        onItemCompleted: (completed, total, item) => {
          options.onProgress?.({
            phase: 'probe',
            folderType: 'random',
            currentPath: item,
            filesDiscovered: total,
            filesProcessed: completed,
            totalFiles: total,
          })
        },
      },
    )

    console.log(`[ScanMusic] randomTracks scanned: ${randomTracks.length}`)
    allTracks.push(...randomTracks.filter((track): track is ScannedTrack => track !== null))
  }

  throwIfAborted(options.signal)

  const priorityTracks = allTracks.filter((track) => track.folderType === 'priority')
  const randomTracks = allTracks.filter((track) => track.folderType === 'random')

  console.log(`[ScanMusic] tracks total: ${allTracks.length}`)

  const summary: ScanSummary = {
    priorityCount: priorityTracks.length,
    randomCount: randomTracks.length,
    totalCount: allTracks.length,
    priorityDuration: priorityTracks.reduce((sum, track) => sum + track.duration, 0),
    randomDuration: randomTracks.reduce((sum, track) => sum + track.duration, 0),
    totalDuration: allTracks.reduce((sum, track) => sum + track.duration, 0),
  }

  const result: ScanMusicResult = {
    tracks: allTracks,
    summary,
    scannedAt: Date.now(),
    // Danh sách file không phải chuẩn AAC (.m4a/.aac) — cần chuẩn hóa
    nonAacFiles: allTracks
      .filter((track) => !AAC_EXTENSIONS.has(path.extname(track.path).toLowerCase()))
      .map((track) => track.path),
  }

  saveScanResult(result)
  return result
}
