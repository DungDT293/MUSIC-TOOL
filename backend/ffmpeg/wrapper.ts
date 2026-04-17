import { spawn, ChildProcess } from 'child_process'
import { getFfmpegPaths } from './config'
import path from 'node:path'
import fs from 'node:fs'
import { videoJobManager } from '../video/videoJobManager'

export interface FfmpegProgress {
  timeSec: number // thời gian đã xử lý
  rawTime?: string // "HH:MM:SS.xx"
}

export interface FfmpegExecOptions {
  args: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  onStdoutChunk?: (chunk: string) => void
  onStderrChunk?: (chunk: string) => void
  onProgress?: (p: FfmpegProgress) => void
  timeoutMs?: number
  signal?: AbortSignal // AbortSignal để cancel
  requestId?: string // RequestId để register vào videoJobManager (nếu cần)
}

/**
 * Convert time string "HH:MM:SS.xx" to seconds (float)
 */
function parseTimeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':')
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0
    const minutes = parseFloat(parts[1]) || 0
    const seconds = parseFloat(parts[2]) || 0
    return hours * 3600 + minutes * 60 + seconds
  }
  return 0
}

export async function runFfmpeg(opts: FfmpegExecOptions): Promise<{
  code: number
  stdout: string
  stderr: string
}> {
  const paths = getFfmpegPaths()
  const { args, cwd, env, onStdoutChunk, onStderrChunk, onProgress, timeoutMs, signal, requestId } = opts

  // Xử lý Windows long path
  let ffmpegPath = paths.ffmpeg
  if (process.platform === 'win32' && ffmpegPath.match(/^[A-Z]:\\.*$/) && ffmpegPath.length > 240) {
    if (!ffmpegPath.startsWith('\\\\?\\')) {
      ffmpegPath = '\\\\?\\' + ffmpegPath
    }
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const stderrChunks: Buffer[] = []

    const child: ChildProcess = spawn(ffmpegPath, args, {
      cwd: cwd || process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true, // FIX M16: Prevent CMD flash on Windows
    })

    // Register process vào videoJobManager để có thể cancel (nếu có requestId)
    if (requestId) {
      videoJobManager.registerJob(requestId, child)
    }

    let timeoutId: NodeJS.Timeout | null = null

    if (timeoutMs && timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        try {
          child.kill('SIGTERM')
          // SIGKILL fallback after 2s — needed on Windows where SIGTERM is a no-op
          setTimeout(() => {
            try { if (!child.killed) child.kill('SIGKILL') } catch {}
          }, 2000)
        } catch (err) {
          // Ignore kill errors
        }
        reject(new Error(`FFmpeg timeout after ${timeoutMs}ms`))
      }, timeoutMs)
    }

    // Listen AbortSignal để cancel khi cần
    // FIX M9: Use { once: true } to prevent listener leak — each runFfmpeg call
    // adds a listener to a potentially long-lived AbortSignal (e.g. from AbortController
    // shared across retries). Without { once: true }, listeners accumulate and never GC.
    if (signal) {
      signal.addEventListener('abort', () => {
        console.log(`[runFfmpeg] Job ${requestId || 'unknown'} cancelled via AbortSignal`)
        // Bug #28 fix: clear timeout so it doesn't race with abort
        if (timeoutId) clearTimeout(timeoutId)
        if (!child.killed) {
          child.kill('SIGTERM')
          setTimeout(() => {
            try { if (!child.killed) child.kill('SIGKILL') } catch {}
          }, 2000)
        }
      }, { once: true })
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      if (onStdoutChunk) {
        onStdoutChunk(chunk.toString('utf-8'))
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      // Check nếu job đã bị cancel
      if (signal?.aborted || (requestId && videoJobManager.isCancelled(requestId))) {
        return // Không xử lý progress nữa
      }

      stderrChunks.push(chunk)
      const chunkStr = chunk.toString('utf-8')
      if (onStderrChunk) {
        onStderrChunk(chunkStr)
      }

      // Parse progress từ FFmpeg stderr
      if (onProgress) {
        const match = chunkStr.match(/time=\s*([0-9:.]+)/)
        if (match && match[1]) {
          const rawTime = match[1]
          const timeSec = parseTimeToSeconds(rawTime)
          onProgress({ timeSec, rawTime })
        }
      }
    })

    child.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId)
      reject(err)
    })

    child.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId)

      // Nếu job đã bị cancel, reject với error
      if (signal?.aborted || (requestId && videoJobManager.isCancelled(requestId))) {
        reject(new Error('Đã dừng bởi người dùng'))
        return
      }

      const stdout = Buffer.concat(chunks).toString('utf-8')
      const stderr = Buffer.concat(stderrChunks).toString('utf-8')

      const result = {
        code: code ?? -1,
        stdout,
        stderr,
      }

      if (code !== 0) {
        const errorMsg = `FFmpeg exited with code ${code}. stderr: ${stderr.slice(-500)}`
        reject(new Error(errorMsg))
      } else {
        resolve(result)
      }
    })
  })
}

export async function runFfprobe(args: string[], timeoutMs = 30_000): Promise<string> {
  const paths = getFfmpegPaths()

  // Xử lý Windows long path
  let ffprobePath = paths.ffprobe
  if (process.platform === 'win32' && ffprobePath.match(/^[A-Z]:\\.*$/) && ffprobePath.length > 240) {
    if (!ffprobePath.startsWith('\\\\?\\')) {
      ffprobePath = '\\\\?\\' + ffprobePath
    }
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const stderrChunks: Buffer[] = []

    const child = spawn(ffprobePath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true, // FIX M16: Prevent CMD flash on Windows
    })

    // Bug #30 fix: add timeout so a hung ffprobe never blocks forever
    const timeoutId = setTimeout(() => {
      try {
        child.kill('SIGTERM')
        setTimeout(() => {
          try { if (!child.killed) child.kill('SIGKILL') } catch {}
        }, 2000)
      } catch {}
      reject(new Error(`ffprobe timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk)
    })

    child.on('error', (err) => {
      clearTimeout(timeoutId)
      reject(err)
    })

    child.on('close', (code) => {
      clearTimeout(timeoutId)
      const stdout = Buffer.concat(chunks).toString('utf-8')
      const stderr = Buffer.concat(stderrChunks).toString('utf-8')

      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}. stderr: ${stderr.slice(-500)}`))
      } else {
        resolve(stdout)
      }
    })
  })
}









