import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'crypto'
import { probeFile } from '../ffmpeg/probe'
import { loadReusableScanResult, saveScanResult } from './scanStore'

export type MusicFolderType = 'priority' | 'random'

export interface MusicScanGenre {
  id: string
  name: string
  priorityFolders: string[]
  randomFolders: string[]
}

export interface ScanMusicConfig {
  version: 2
  genres: MusicScanGenre[]
}

export interface ScannedTrack {
  id: string // unique
  path: string
  fileName: string
  folderType: MusicFolderType
  genreId?: string
  genreName?: string
  sourceFolder?: string
  duration: number // seconds
  size: number // bytes
  codec?: string
  bitrate?: number
}

export interface GenreScanSummary {
  genreId: string
  genreName: string
  priorityCount: number
  randomCount: number
  totalCount: number
  priorityDuration: number
  randomDuration: number
  totalDuration: number
}

export interface ScanSummary {
  priorityCount: number
  randomCount: number
  totalCount: number
  priorityDuration: number // seconds
  randomDuration: number // seconds
  totalDuration: number // seconds
  genres?: GenreScanSummary[]
}

export interface ScanMusicResult {
  tracks: ScannedTrack[]
  summary: ScanSummary
  scannedAt?: number
  config?: ScanMusicConfig
  cacheStatus?: 'scanned' | 'reused' | 'loaded'
  /** Các file audio KHÔNG phải chuẩn AAC (.m4a / .aac). Cần chuẩn hóa. */
  nonAacFiles?: string[]
}

export interface ScanMusicPayload {
  priorityFolder?: string | null
  randomFolder?: string | null
  genres?: MusicScanGenre[]
  forceRescan?: boolean
  persist?: boolean
}

export interface ScanMusicProgress {
  phase: 'discover' | 'probe'
  folderType: MusicFolderType
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

function normalizeFolderList(folders: unknown): string[] {
  if (!Array.isArray(folders)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const folder of folders) {
    if (typeof folder !== 'string') continue
    const trimmed = folder.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

export function normalizeScanPayload(payload: ScanMusicPayload): ScanMusicConfig {
  const rawGenres = Array.isArray(payload.genres) ? payload.genres : []
  const genres = rawGenres.map((genre, index) => ({
    id: String(genre.id || `genre-${index + 1}`).trim() || `genre-${index + 1}`,
    name: String(genre.name || `Thể loại ${index + 1}`).trim() || `Thể loại ${index + 1}`,
    priorityFolders: normalizeFolderList(genre.priorityFolders),
    randomFolders: normalizeFolderList(genre.randomFolders),
  })).filter((genre) => genre.priorityFolders.length > 0 || genre.randomFolders.length > 0)

  if (genres.length > 0) {
    const usedIds = new Set<string>()
    return {
      version: 2,
      genres: genres.map((genre, index) => {
        let id = genre.id
        if (usedIds.has(id)) id = `${id}-${index + 1}`
        usedIds.add(id)
        return { ...genre, id }
      }),
    }
  }

  const legacyPriority = typeof payload.priorityFolder === 'string' && payload.priorityFolder.trim()
    ? [payload.priorityFolder.trim()]
    : []
  const legacyRandom = typeof payload.randomFolder === 'string' && payload.randomFolder.trim()
    ? [payload.randomFolder.trim()]
    : []

  return {
    version: 2,
    genres: legacyPriority.length > 0 || legacyRandom.length > 0
      ? [{ id: 'default', name: 'Mặc định', priorityFolders: legacyPriority, randomFolders: legacyRandom }]
      : [],
  }
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
  folderType: MusicFolderType,
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
  folderType: MusicFolderType,
  meta: { genreId?: string; genreName?: string; sourceFolder?: string } = {},
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
      genreId: meta.genreId,
      genreName: meta.genreName,
      sourceFolder: meta.sourceFolder,
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

export const __scanMusicTestUtils = {
  normalizeScanPayload,
}

export async function scanAudioFilesAsTracks(
  paths: string[],
  folderType: ScannedTrack['folderType'] = 'random',
  options: ScanMusicOptions = {},
): Promise<ScannedTrack[]> {
  const uniquePaths = Array.from(new Set((paths ?? []).filter(Boolean)))
  const tracks = await runWithConcurrency(
    uniquePaths,
    5,
    (filePath) => scanSingleFile(filePath, folderType),
    {
      signal: options.signal,
      onItemCompleted: (completed, total, item) => {
        options.onProgress?.({
          phase: 'probe',
          folderType,
          currentPath: item,
          filesDiscovered: total,
          filesProcessed: completed,
          totalFiles: total,
        })
      },
    },
  )
  return tracks.filter((track): track is ScannedTrack => track !== null)
}

async function addUniqueFiles(
  target: string[],
  files: string[],
  globalSeenRealPaths: Set<string>,
): Promise<void> {
  for (const filePath of files) {
    let realFile: string
    try {
      realFile = await fsp.realpath(filePath)
    } catch {
      realFile = filePath
    }
    const key = realFile.toLowerCase()
    if (globalSeenRealPaths.has(key)) continue
    globalSeenRealPaths.add(key)
    target.push(filePath)
  }
}

function buildSummary(tracks: ScannedTrack[], config: ScanMusicConfig): ScanSummary {
  const priorityTracks = tracks.filter((track) => track.folderType === 'priority')
  const randomTracks = tracks.filter((track) => track.folderType === 'random')
  const genres = config.genres.map((genre) => {
    const genreTracks = tracks.filter((track) => track.genreId === genre.id)
    const genrePriority = genreTracks.filter((track) => track.folderType === 'priority')
    const genreRandom = genreTracks.filter((track) => track.folderType === 'random')
    return {
      genreId: genre.id,
      genreName: genre.name,
      priorityCount: genrePriority.length,
      randomCount: genreRandom.length,
      totalCount: genreTracks.length,
      priorityDuration: genrePriority.reduce((sum, track) => sum + track.duration, 0),
      randomDuration: genreRandom.reduce((sum, track) => sum + track.duration, 0),
      totalDuration: genreTracks.reduce((sum, track) => sum + track.duration, 0),
    }
  })

  return {
    priorityCount: priorityTracks.length,
    randomCount: randomTracks.length,
    totalCount: tracks.length,
    priorityDuration: priorityTracks.reduce((sum, track) => sum + track.duration, 0),
    randomDuration: randomTracks.reduce((sum, track) => sum + track.duration, 0),
    totalDuration: tracks.reduce((sum, track) => sum + track.duration, 0),
    genres,
  }
}

export async function scanMusicFolders(
  payload: ScanMusicPayload,
  options: ScanMusicOptions = {},
): Promise<ScanMusicResult> {
  const config = normalizeScanPayload(payload)

  if (config.genres.length === 0) {
    throw new Error('No folders provided')
  }

  if (!payload.forceRescan) {
    const reusable = loadReusableScanResult(config)
    if (reusable) return reusable
  }

  const allTracks: ScannedTrack[] = []
  const globalSeenRealPaths = new Set<string>()
  throwIfAborted(options.signal)

  for (const genre of config.genres) {
    for (const [folderType, folders] of [
      ['priority', genre.priorityFolders] as const,
      ['random', genre.randomFolders] as const,
    ]) {
      for (const folder of folders) {
        throwIfAborted(options.signal)
        if (!fs.existsSync(folder)) {
          throw new Error(`${folderType === 'priority' ? 'Priority' : 'Random'} folder does not exist: ${folder}`)
        }

        console.log(`[ScanMusic] Scanning ${folderType} folder (${genre.name}): ${folder}`)
        const discoveredFiles = await getAllAudioFiles(folder, folderType, options)
        const uniqueFiles: string[] = []
        await addUniqueFiles(uniqueFiles, discoveredFiles, globalSeenRealPaths)
        console.log(`[ScanMusic] ${folderType} files (${genre.name}): ${uniqueFiles.length}/${discoveredFiles.length}`)

        const tracks = await runWithConcurrency(
          uniqueFiles,
          5,
          (filePath) => scanSingleFile(filePath, folderType, {
            genreId: genre.id,
            genreName: genre.name,
            sourceFolder: folder,
          }),
          {
            signal: options.signal,
            onItemCompleted: (completed, total, item) => {
              options.onProgress?.({
                phase: 'probe',
                folderType,
                currentPath: item,
                filesDiscovered: total,
                filesProcessed: completed,
                totalFiles: total,
              })
            },
          },
        )

        console.log(`[ScanMusic] ${folderType} tracks scanned (${genre.name}): ${tracks.length}`)
        allTracks.push(...tracks.filter((track): track is ScannedTrack => track !== null))
      }
    }
  }

  throwIfAborted(options.signal)
  console.log(`[ScanMusic] tracks total: ${allTracks.length}`)

  const result: ScanMusicResult = {
    tracks: allTracks,
    summary: buildSummary(allTracks, config),
    scannedAt: Date.now(),
    config,
    cacheStatus: 'scanned',
    // Danh sách file không phải chuẩn AAC (.m4a/.aac) — cần chuẩn hóa
    nonAacFiles: allTracks
      .filter((track) => !AAC_EXTENSIONS.has(path.extname(track.path).toLowerCase()))
      .map((track) => track.path),
  }

  if (payload.persist !== false) {
    saveScanResult(result)
  }
  return result
}
