import { spawn } from 'child_process'
import path from 'node:path'

/**
 * Result shape returned by faster_whisper_service.py
 */
export interface FasterWhisperWord {
  word: string
  start: number
  end: number
}

export interface FasterWhisperSegment {
  text: string
  start: number
  end: number
  words?: FasterWhisperWord[]
}

export interface FasterWhisperResult {
  text: string
  segments: FasterWhisperSegment[]
}

/**
 * Resolve path to the Python script inside the built app.
 * In dev, __dirname will point to backend/audio; in prod, to dist-electron/main/backend/audio.
 * We climb up and into backend/python.
 */
function getPythonScriptPath(): string {
  // Try multiple locations so it works in both DEV and packaged builds
  const candidates = [
    // DEV: run from project root
    path.join(process.cwd(), 'backend', 'python', 'faster_whisper_service.py'),
    // Built main chunk location (dist-electron/main/backend/audio)
    path.join(path.resolve(__dirname, '..'), 'python', 'faster_whisper_service.py'),
  ]

  // If Electron resourcesPath exists, also try there (packaged as extraResources)
  const resourcesPath = (process as any).resourcesPath
  if (resourcesPath && typeof resourcesPath === 'string') {
    candidates.push(path.join(resourcesPath, 'python', 'faster_whisper_service.py'))
  }

  const found = candidates.find((p) => {
    try {
      return require('fs').existsSync(p)
    } catch {
      return false
    }
  })

  if (found) return found

  // Last resort: return the first candidate (ffmpeg will fail with clear path)
  return candidates[0]
}

interface GpuWhisperOptions {
  audioPath: string
  language?: string
  model?: string
  beamSize?: number
}

/**
 * Call external Python Faster-Whisper service on GPU.
 * This requires:
 *  - Python in PATH (or PYTHON_EXEC env)
 *  - pip install faster-whisper
 *  - CUDA/cuDNN properly installed
 */
export function transcribeWithFasterWhisper(
  options: GpuWhisperOptions
): Promise<FasterWhisperResult> {
  const {
    audioPath,
    language = 'auto',
    model = process.env.WHISPER_GPU_MODEL || 'small',
    beamSize = 5,
  } = options

  const pythonExec = process.env.PYTHON_EXEC || 'python'
  const scriptPath = getPythonScriptPath()

  return new Promise((resolve, reject) => {
    const args = [
      scriptPath,
      '--audio',
      audioPath,
      '--model',
      model,
      '--language',
      language,
      '--beam_size',
      String(beamSize),
    ]

    const child = spawn(pythonExec, args, {
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
    })

    child.on('error', (err) => {
      reject(
        new Error(
          `[GPU-Whisper] Failed to start Python process: ${err.message}. stderr: ${stderr.substring(
            0,
            500
          )}`
        )
      )
    })

    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `[GPU-Whisper] Python exited with code ${code}. stderr: ${stderr.substring(0, 1000)}`
          )
        )
        return
      }

      try {
        const parsed = JSON.parse(stdout) as FasterWhisperResult
        resolve(parsed)
      } catch (e) {
        reject(
          new Error(
            `[GPU-Whisper] Failed to parse JSON from Python. Error: ${
              (e as Error).message
            }, stdout snippet: ${stdout.substring(0, 500)}, stderr snippet: ${stderr.substring(
              0,
              500
            )}`
          )
        )
      }
    })
  })
}


