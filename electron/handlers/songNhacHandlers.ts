/**
 * songNhacHandlers.ts
 * IPC handlers: song-nhac:*, autopilot:*
 */

import { ipcMain, BrowserWindow, app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import { spawn } from 'node:child_process'
import { isValidAbsolutePath } from '../authState'
import {
  startAutopilot,
  getAutopilotProgress,
  getRecentAutopilotLogs,
  onAutopilotProgress,
  cancelAutopilot,
  onAutopilotLog,
  getAutopilotLogVerbosity,
  setAutopilotLogVerbosity,
  type AutopilotConfig as AutopilotBackendConfig,
  type AutopilotLogVerbosity,
  type AutopilotProgress,
} from '../../backend/autopilot/autopilotRunner'

// Map để track active FFmpeg processes cho Song Nhạc export
export const activeSongNhacExports = new Map<string, import('child_process').ChildProcess>()

// ── PCM pre-decode cache: jobId → { pcm, sampleRate, duration } ──
// Audio is decoded once by FFmpeg in main process → offscreen renderer fetches 2048 samples per frame via IPC.
// This avoids the SLOW Web Audio API decodeAudioData path (~10+ min for 1h files).
interface PcmCache {
  pcm: Float32Array
  sampleRate: number
  duration: number
}
const pcmCacheMap = new Map<string, PcmCache>()
let autopilotStartInFlight = false

/**
 * Decode audio file → mono PCM Float32 using FFmpeg.
 * Fast: FFmpeg native decoders → ~2-5s for 1h file (vs 10+ min Web Audio API).
 */
async function decodeAudioToPcm(audioFilePath: string, targetSampleRate = 44100): Promise<PcmCache> {
  const { getFfmpegPaths } = await import('../../backend/ffmpeg/config')
  const paths = getFfmpegPaths()
  const ffmpegPath = (paths as any).ffmpeg ?? (paths as any).ffmpegPath

  return new Promise<PcmCache>((resolve, reject) => {
    // FFmpeg: decode any audio → mono PCM float32 raw data to stdout
    const args = [
      '-i', audioFilePath,
      '-f', 'f32le',          // Raw float32 little-endian
      '-acodec', 'pcm_f32le',
      '-ac', '1',             // Mono
      '-ar', String(targetSampleRate),
      'pipe:1',               // Output to stdout
    ]

    console.log(`[SongNhac PCM] Decoding audio: ${audioFilePath}`)
    const startTime = Date.now()

    const proc = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const chunks: Buffer[] = []
    let totalBytes = 0

    proc.stdout!.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      totalBytes += chunk.length
    })

    let stderrText = ''
    proc.stderr!.on('data', (chunk: Buffer) => {
      stderrText += chunk.toString()
    })

    proc.on('error', (err) => {
      reject(new Error(`FFmpeg PCM decode error: ${err.message}`))
    })

    proc.on('close', (code) => {
      if (code !== 0) {
        const lastLines = stderrText.split('\n').slice(-5).join('\n')
        reject(new Error(`FFmpeg PCM decode failed (code ${code}): ${lastLines}`))
        return
      }

      // Combine chunks → Float32Array
      const combined = Buffer.concat(chunks)
      // Ensure proper alignment: copy to a fresh ArrayBuffer to avoid byteOffset issues
      const alignedBuffer = new ArrayBuffer(combined.byteLength)
      new Uint8Array(alignedBuffer).set(new Uint8Array(combined.buffer, combined.byteOffset, combined.byteLength))
      const pcm = new Float32Array(alignedBuffer)
      const duration = pcm.length / targetSampleRate
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

      console.log(`[SongNhac PCM] Decoded: ${duration.toFixed(1)}s, ${pcm.length} samples, ${(totalBytes / 1024 / 1024).toFixed(1)}MB, took ${elapsed}s`)

      resolve({ pcm, sampleRate: targetSampleRate, duration })
    })
  })
}

export function registerSongNhacHandlers(getMainWindow: () => BrowserWindow | null) {
  // ===== Autopilot =====

  onAutopilotProgress((progress: AutopilotProgress) => {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) win.webContents.send('autopilot:status', progress)
    }
  })

  onAutopilotLog((log) => {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) win.webContents.send('autopilot:log', log)
    }
  })

  ipcMain.handle('autopilot:getStatus', async () => getAutopilotProgress())
  ipcMain.handle('autopilot:getRecentLogs', async (_event, limit?: number) => getRecentAutopilotLogs(limit))
  ipcMain.handle('autopilot:getLogVerbosity', async () => getAutopilotLogVerbosity())
  ipcMain.handle('autopilot:setLogVerbosity', async (_event, verbosity: AutopilotLogVerbosity) => {
    return { ok: true, verbosity: setAutopilotLogVerbosity(verbosity) }
  })

  ipcMain.handle('autopilot:start', async (_event, config: AutopilotBackendConfig) => {
    if (autopilotStartInFlight) {
      return { ok: false, error: 'Autopilot đang khởi động. Hãy chờ health-check hiện tại hoàn tất.' }
    }
    autopilotStartInFlight = true
    try {
      const status = getAutopilotProgress().status
      if (status === 'running' || status === 'paused' || status === 'cancelling') {
        return { ok: false, error: 'Autopilot đang chạy hoặc đang dừng. Hãy chờ job hiện tại kết thúc trước khi chạy job mới.' }
      }
      const { runAutopilotHealthCheck } = await import('../../backend/autopilot/healthCheck')
      const healthCheck = await runAutopilotHealthCheck(config)
      if (!healthCheck.ok) {
        return { ok: false, error: healthCheck.error || 'Autopilot health-check failed.' }
      }

      const effectiveConfig: AutopilotBackendConfig = {
        ...config,
        runtimeOverrides: {
          ...config.runtimeOverrides,
          finalExportUseGpuEncoding: healthCheck.recommendedUseGpuEncoding,
          requireGpuForVideoEncode: config.runtimeOverrides?.requireGpuForVideoEncode,
          healthCheckNotice: healthCheck.notice,
          healthCheckNoticeLevel: healthCheck.noticeLevel,
          resolvedGpuProfile: healthCheck.resolvedGpuProfile,
          resolvedGpuFfmpegPath: healthCheck.resolvedGpuFfmpegPath,
          resolvedGpuEncoder: healthCheck.resolvedGpuEncoder,
          gpuFallbackReason: healthCheck.gpuFallbackReason,
        },
      }

      startAutopilot(effectiveConfig).catch((error: any) => {
        console.error('[Autopilot] Pipeline error (background):', error)
      })
      return { ok: true }
    } catch (error: any) {
      console.error('[Autopilot] Failed to start:', error)
      return { ok: false, error: error?.message || String(error) }
    } finally {
      autopilotStartInFlight = false
    }
  })

  ipcMain.handle('autopilot:cancel', async () => {
    cancelAutopilot()
    return { ok: true }
  })

  // Scan video folders for autopilot
  ipcMain.handle('autopilot:scan-video-folders', async (_event, rootVideo: string) => {
    if (!rootVideo || typeof rootVideo !== 'string') return { totalFiles: 0, folders: [] }

    const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.ts', '.m2ts', '.m4v'])
    const folders = rootVideo.split('\n').map(f => f.trim()).filter(f => f.length > 0)
    const SCAN_CONCURRENCY = 8

    // Validate each folder path
    const validFolders = folders.filter(f => isValidAbsolutePath(f))
    if (validFolders.length === 0) return { totalFiles: 0, folders: [] }

    const result: { totalFiles: number; folders: Array<{ folder: string; count: number }> } = {
      totalFiles: 0,
      folders: [],
    }

    const walkAsync = async (rootDir: string): Promise<number> => {
      let count = 0
      const queue: string[] = [rootDir]

      const worker = async () => {
        while (queue.length > 0) {
          const dir = queue.shift()
          if (!dir) return
          try {
            const entries = await fsp.readdir(dir, { withFileTypes: true })
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name)
              try {
                if (entry.isDirectory()) {
                  queue.push(fullPath)
                } else if (entry.isFile()) {
                  const ext = path.extname(entry.name).toLowerCase()
                  if (VIDEO_EXTENSIONS.has(ext)) count++
                }
              } catch {}
            }
          } catch {}
        }
      }

      await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, () => worker()))
      return count
    }

    for (const folder of validFolders) {
      try {
        await fsp.access(folder)
      } catch {
        result.folders.push({ folder, count: 0 })
        continue
      }
      const count = await walkAsync(folder)
      result.folders.push({ folder, count })
      result.totalFiles += count
    }
    return result
  })

  // Video Pool IPC
  ipcMain.handle('autopilot:video-pool-stats', async () => {
    const { getPoolStats } = await import('../../backend/autopilot/videoPool')
    return getPoolStats()
  })

  ipcMain.handle('autopilot:video-pool-clear', async () => {
    const { clearPool } = await import('../../backend/autopilot/videoPool')
    clearPool()
    return { ok: true }
  })

  // Security monitoring
  ipcMain.handle('security:reportAntiDebug', async (_event, details: { method: string; detected: boolean }) => {
    const { reportAntiDebugTriggered } = await import('../../backend/security/securityMonitoring')
    await reportAntiDebugTriggered(details)
    return { ok: true }
  })

  // ===== Song Nhạc Export =====

  // ── IPC handler: return 2048 PCM samples at a given time ──
  // Called per-frame from offscreen renderer ExportRunner via IPC.
  // Cost: ~0.1ms per call (memory read + structured clone of 8KB Float32Array).
  ipcMain.handle('song-nhac:pcm-samples', (_event, jobId: string, timeSec: number) => {
    const cache = pcmCacheMap.get(jobId)
    if (!cache) return new Float32Array(2048)

    const FFT_SIZE = 2048
    const centerSample = Math.floor(timeSec * cache.sampleRate)
    const startSample = Math.max(0, centerSample - FFT_SIZE / 2)
    const endSample = Math.min(cache.pcm.length, startSample + FFT_SIZE)

    // Extract slice — if near end of file, pad with zeros
    const result = new Float32Array(FFT_SIZE)
    const copyLen = endSample - startSample
    if (copyLen > 0) {
      result.set(cache.pcm.subarray(startSample, endSample))
    }
    return result
  })

  /**
   * Converts app://local-file/?path=<encoded> or file:// URL to local filesystem path.
   */
  function audioUrlToLocalPath(audioFileUrl: string): string | null {
    if (!audioFileUrl) return null
    let audioPath = audioFileUrl
    try {
      if (audioPath.startsWith('app://local-file/')) {
        // Format: app://local-file/?path=E%3A%5Cmusic%5Csong.mp3
        const u = new URL(audioPath)
        const p = u.searchParams.get('path')
        if (p) {
          audioPath = decodeURIComponent(p)
        } else {
          // Fallback: strip prefix and decode (old-style URLs without ?path=)
          audioPath = decodeURIComponent(audioPath.replace('app://local-file/', ''))
        }
      } else if (audioPath.startsWith('file://')) {
        audioPath = decodeURIComponent(new URL(audioPath).pathname)
        // Windows: remove leading slash from /C:/path
        if (process.platform === 'win32' && audioPath.startsWith('/')) {
          audioPath = audioPath.slice(1)
        }
      }
    } catch {
      return null
    }
    if (audioPath && fs.existsSync(audioPath)) {
      return audioPath
    }
    console.warn('[SongNhac] Audio file not found:', audioPath)
    return null
  }

  ipcMain.handle('song-nhac:export-video', async (_event, options: any) => {
    const jobId: string = options?.jobId ?? `sn-${Date.now()}`
    let frameHandler: ((_ev: any, _jobIdArg: string, frameData: Buffer) => void) | null = null
    let endHandler: (() => void) | null = null
    let offscreenWindow: BrowserWindow | null = null
    let exportReadyHandler: ((_ev: any) => void) | null = null
    let exportDoneHandler: ((_ev: any, _result: any) => void) | null = null
    let progressReportHandler: ((_ev: any, _progress: any) => void) | null = null

    try {
      const { startFfmpegPipe } = await import('../../backend/video/songNhacFfmpegPipe')

      // ─── Transform frontend config → backend SongNhacExportOptions ───
      const audioPaths: string[] = []
      if (options.audioFileUrl) {
        const resolved = audioUrlToLocalPath(options.audioFileUrl)
        if (resolved) audioPaths.push(resolved)
      }

      // Generate outputPath if not provided
      let outputPath = options.outputPath
      if (!outputPath) {
        const exportDir = path.join(app.getPath('userData'), 'exports')
        if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true })
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const audioName = options.audioDisplayName
          ? options.audioDisplayName.replace(/[<>:"/\\|?*]/g, '_').slice(0, 60)
          : 'export'
        outputPath = path.join(exportDir, `${audioName}_${timestamp}.mp4`)
      }

      // Map encoder quality to FFmpeg preset/CRF
      // CRF = constant quality factor: lower = better quality, larger file
      // 17-18 = visually lossless, 20 = very good, 23 = good, 25 = acceptable
      // videoBitrate is now only used as maxrate safety ceiling (not target)
      let preset = 'medium'
      let crf = 18
      let videoBitrate = '15000k'
      switch (options.encoderQuality) {
        case 'ultra-fast':
          preset = 'ultrafast'; crf = 22; videoBitrate = '12000k'; break
        case 'fast':
          preset = 'fast'; crf = 19; videoBitrate = '15000k'; break
        case 'balanced':
          preset = 'medium'; crf = 17; videoBitrate = '20000k'; break
        case 'lowend':
          preset = 'veryfast'; crf = 25; videoBitrate = '8000k'; break
      }

      const totalFrames = Math.max(1, Math.floor((options.durationSec ?? 0) * (options.fps ?? 30)))

      const ffmpegOptions = {
        outputPath,
        width: options.width ?? 1280,
        height: options.height ?? 720,
        fps: options.fps ?? 30,
        audioPaths,
        totalFrames,
        videoBitrate,
        preset,
        crf,
        useGpu: options.forceCpuEncoder !== true, // GPU mặc định, trừ khi user chọn "máy yếu"
      }

      // ─── Pre-decode audio to PCM (FAST: FFmpeg ~2-5s vs Web Audio 10+ min) ───
      let pcmReady = false
      let pcmSampleRate = 44100
      let pcmDuration = 0
      if (audioPaths.length > 0) {
        try {
          console.log('[SongNhac] Pre-decoding audio to PCM via FFmpeg...')
          const pcmResult = await decodeAudioToPcm(audioPaths[0], 44100)
          pcmCacheMap.set(jobId, pcmResult)
          pcmReady = true
          pcmSampleRate = pcmResult.sampleRate
          pcmDuration = pcmResult.duration
          console.log(`[SongNhac] PCM ready: ${pcmDuration.toFixed(1)}s @ ${pcmSampleRate}Hz`)
        } catch (pcmErr) {
          console.warn('[SongNhac] PCM pre-decode failed, offscreen will use Web Audio fallback:', pcmErr)
          // Non-fatal — ExportRunner will fall back to createAudioSourcePrecomputed
        }
      }

      // ─── Create offscreen BrowserWindow for ExportRunner ───
      // ExportRunner mounts when window.location.hash === '#export'
      const preloadPath = path.join(__dirname, '../preload/preload.js')
      console.log('[SongNhac] Creating offscreen export window...')

      offscreenWindow = new BrowserWindow({
        show: false,
        width: ffmpegOptions.width,
        height: ffmpegOptions.height,
        webPreferences: {
          preload: preloadPath,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          // Security: removed webSecurity:false — app:// protocol is already registered as privileged
          // and can serve local files without disabling same-origin policy
        },
      })

      // Load the same renderer but with #export hash → App.tsx renders ExportRunner
      const isDev = !!process.env.ELECTRON_RENDERER_URL
      if (isDev) {
        const devUrl = process.env.ELECTRON_RENDERER_URL!
        // Remove any existing hash and add #export
        const baseUrl = devUrl.split('#')[0]
        await offscreenWindow.loadURL(`${baseUrl}#export`)
      } else {
        const indexPath = path.join(__dirname, '../../dist/index.html')
        await offscreenWindow.loadFile(indexPath, { hash: 'export' })
      }
      console.log('[SongNhac] Offscreen window loaded')

      // ─── Wait for ExportRunner to signal it's ready ───
      let rendererSupportsWebCodecs = false
      await new Promise<void>((resolve, reject) => {
        const readyTimeout = setTimeout(() => {
          reject(new Error('Offscreen ExportRunner did not signal ready within 30s'))
        }, 30_000)

        exportReadyHandler = (_ev: any, opts?: { webcodecs?: boolean }) => {
          clearTimeout(readyTimeout)
          rendererSupportsWebCodecs = opts?.webcodecs === true
          console.log(`[SongNhac] ExportRunner ready. WebCodecs: ${rendererSupportsWebCodecs}`)
          resolve()
        }
        ipcMain.once('song-nhac:export-ready', exportReadyHandler)
      })

      // ─── Start FFmpeg pipe (async — detects GPU first) ───
      // Set webCodecsMode if renderer supports it → FFmpeg uses -c:v copy (no re-encode)
      const finalFfmpegOptions = { ...ffmpegOptions, webCodecsMode: rendererSupportsWebCodecs }
      const { ffmpegProc, waitForExit, usedEncoder } = await startFfmpegPipe(finalFfmpegOptions)
      activeSongNhacExports.set(jobId, ffmpegProc)

      // ─── Frame handler: renderer → FFmpeg stdin ───
      let framesReceived = 0
      frameHandler = (_ev: any, _jobIdArg: string, frameData: Buffer | ArrayBuffer) => {
        if (ffmpegProc.stdin && !ffmpegProc.stdin.destroyed) {
          // Electron IPC sends ArrayBuffer from renderer — stdin.write() requires Buffer
          const buf = Buffer.isBuffer(frameData) ? frameData : Buffer.from(frameData)
          ffmpegProc.stdin.write(buf)
          framesReceived++
        }
      }
      ipcMain.on('song-nhac:frame', frameHandler)

      // ─── Progress reporting: forward to main window ───
      progressReportHandler = (_ev: any, progress: any) => {
        const mainWindow = getMainWindow()
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('song-nhac:export-progress', {
            frameIndex: progress?.frameIndex,
            totalFrames: progress?.totalFrames,
          })
        }
      }
      ipcMain.on('song-nhac:export-progress-report', progressReportHandler)

      // ─── Notify main window that export started ───
      const mainWindow = getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('song-nhac:export-started', { jobId })
      }

      // ─── End handler: stdin.end() triggers FFmpeg finalization ───
      const END_TIMEOUT_MS = 30 * 60 * 1000 // 30 min for long exports
      const endPromise = new Promise<void>((resolve, reject) => {
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null
        endHandler = () => {
          if (timeoutHandle) clearTimeout(timeoutHandle)
          console.log(`[SongNhac] End signal received. Frames: ${framesReceived}`)
          if (ffmpegProc.stdin && !ffmpegProc.stdin.destroyed) ffmpegProc.stdin.end()
          resolve()
        }
        ipcMain.once('song-nhac:end', endHandler)
        timeoutHandle = setTimeout(() => {
          if (endHandler) ipcMain.removeListener('song-nhac:end', endHandler)
          console.warn(`[SongNhac] Export timed out after ${END_TIMEOUT_MS / 1000}s. Frames received: ${framesReceived}`)
          if (ffmpegProc.stdin && !ffmpegProc.stdin.destroyed) ffmpegProc.stdin.end()
          reject(new Error(`Export timed out after ${END_TIMEOUT_MS / 60000} minutes`))
        }, END_TIMEOUT_MS)
      })

      // ─── Send export config to ExportRunner ───
      // Build the config that ExportRunner expects (ExportConfigFromMain)
      const exportConfig = {
        jobId,
        width: ffmpegOptions.width,
        height: ffmpegOptions.height,
        fps: ffmpegOptions.fps,
        durationSec: options.durationSec ?? 0,
        audioFileUrl: options.audioFileUrl ?? '',
        outputPath,
        devicePixelRatio: 1,
        layers: options.layers,
        runtimeSettings: options.runtimeSettings,
        startSec: options.startSec,
        forceSoftwareRenderer: options.forceSoftwareRenderer ?? options.forceCpuEncoder ?? false,
        // Forward encoder quality so WebCodecs can set proper bitrate
        encoderQuality: options.encoderQuality,
        videoBitrateKbps: parseInt(videoBitrate) || 8000,
        // ── PCM fast path: offscreen renderer fetches samples via IPC ──
        pcmReady,
        pcmSampleRate,
        pcmDuration,
      }
      offscreenWindow.webContents.send('song-nhac:export-config', exportConfig)
      console.log('[SongNhac] Export config sent to offscreen window')

      // ─── Wait for frames + end ───
      await endPromise
      const result = await waitForExit()

      // Build summary for UI
      let fileSizeBytes = 0
      try {
        const stat = fs.statSync(result.outputPath)
        fileSizeBytes = stat.size
      } catch {}

      console.log(`[SongNhac] Export complete. Code: ${result.code}, Frames: ${framesReceived}, Size: ${fileSizeBytes}`)

      return {
        ok: result.code === 0 || result.code === null,
        outPath: result.outputPath,
        outputPath: result.outputPath,
        code: result.code,
        summary: {
          fileSizeBytes,
          durationSec: options.durationSec,
          resolution: `${ffmpegOptions.width}×${ffmpegOptions.height}`,
          usedEncoder: result.usedEncoder ?? usedEncoder,
          framesWritten: framesReceived,
        },
      }
    } catch (error: any) {
      console.error('[SongNhac] Export error:', error)
      return { ok: false, error: error?.message || String(error) }
    } finally {
      if (frameHandler) ipcMain.removeListener('song-nhac:frame', frameHandler)
      if (endHandler) ipcMain.removeListener('song-nhac:end', endHandler)
      if (exportReadyHandler) ipcMain.removeListener('song-nhac:export-ready', exportReadyHandler)
      if (exportDoneHandler) ipcMain.removeListener('song-nhac:export-done', exportDoneHandler)
      if (progressReportHandler) ipcMain.removeListener('song-nhac:export-progress-report', progressReportHandler)
      activeSongNhacExports.delete(jobId)
      // Clean up PCM cache for this job
      pcmCacheMap.delete(jobId)
      // Destroy offscreen window
      if (offscreenWindow && !offscreenWindow.isDestroyed()) {
        try { offscreenWindow.close() } catch {}
        offscreenWindow = null
      }
    }
  })

  ipcMain.handle('song-nhac:get-audio-duration', async (_event, filePath: string) => {
    try {
      if (!isValidAbsolutePath(filePath)) return { ok: false, error: 'Invalid file path' }
      const { runFfprobe } = await import('../../backend/ffmpeg/wrapper')
      const output = await runFfprobe([
        '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
      ])
      const duration = parseFloat(output.trim())
      return { ok: true, duration: isNaN(duration) ? 0 : duration }
    } catch (error: any) {
      return { ok: false, error: error?.message }
    }
  })

  ipcMain.handle('song-nhac:read-audio-file', async (_event, filePath: string) => {
    try {
      if (!isValidAbsolutePath(filePath)) return { ok: false, error: 'Invalid file path' }
      const buffer = fs.readFileSync(filePath)
      return { ok: true, buffer }
    } catch (error: any) {
      return { ok: false, error: error?.message }
    }
  })

  ipcMain.handle('song-nhac:decode-audio-timeline', async (_event, filePath: string) => {
    try {
      if (!isValidAbsolutePath(filePath)) return { ok: false, error: 'Invalid file path' }
      const { runFfprobe } = await import('../../backend/ffmpeg/wrapper')
      const output = await runFfprobe([
        '-v', 'error', '-show_entries', 'format=duration,bit_rate:stream=sample_rate,channels',
        '-of', 'json', filePath,
      ])
      const info = JSON.parse(output)
      return { ok: true, info }
    } catch (error: any) {
      return { ok: false, error: error?.message }
    }
  })

  ipcMain.handle('song-nhac:list-audio-in-folder', async (_event, folderPath: string) => {
    try {
      if (!isValidAbsolutePath(folderPath)) return []
      const audioExts = ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.wma']
      return fs.readdirSync(folderPath)
        .filter(f => audioExts.includes(path.extname(f).toLowerCase()))
        .map(f => ({ name: f, path: path.join(folderPath, f) }))
    } catch (error: any) {
      console.error('[SongNhac] listAudioInFolder error:', error)
      return []
    }
  })

  ipcMain.handle('song-nhac:cancel-export', async (_event, jobId?: string) => {
    if (jobId && activeSongNhacExports.has(jobId)) {
      const proc = activeSongNhacExports.get(jobId)!
      try { if (!proc.killed) proc.kill('SIGTERM') } catch (_) {}
      activeSongNhacExports.delete(jobId)
    } else if (activeSongNhacExports.size > 0) {
      for (const [id, proc] of activeSongNhacExports) {
        try { if (!proc.killed) proc.kill('SIGTERM') } catch (_) {}
        activeSongNhacExports.delete(id)
        break
      }
    }
    // Send cancel to ALL windows (main + offscreen export windows)
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('song-nhac:export-cancel')
      }
    }
    return { ok: true }
  })
}
