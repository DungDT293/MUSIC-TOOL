/**
 * Whisper Transcription Service
 * Uses @xenova/transformers to transcribe audio to text
 */

import { getFfmpegPaths } from '../ffmpeg/config'
import { spawn } from 'child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { transcribeWithFasterWhisper } from './whisperFasterService'

// Cache directory for models - try to use SSD if available
async function getOptimalCacheDir(): Promise<string> {
  const defaultCacheDir = path.join(os.homedir(), '.cache', 'huggingface', 'transformers')
  
  try {
    // Try to detect SSD and use it for cache (faster model loading)
    const { getDiskInfo } = await import('../system/diskInfo')
    const diskInfo = await getDiskInfo()
    
    // Find first SSD drive with enough space (at least 1GB free)
    const minFreeGB = 1
    const minFreeBytes = minFreeGB * 1024 * 1024 * 1024
    
    if (diskInfo.byType.ssd && diskInfo.byType.ssd.freeBytes >= minFreeBytes) {
      // Use SSD for cache - find a drive letter from SSD drives
      for (const drive of diskInfo.drives) {
        if (drive.diskType === 'SSD' && drive.freeBytes && drive.freeBytes >= minFreeBytes) {
          const ssdCacheDir = path.join(drive.drive, 'huggingface', 'transformers')
          console.log(`[Whisper] Using SSD cache directory: ${ssdCacheDir} (${drive.drive} has ${(drive.freeBytes / 1024 / 1024 / 1024).toFixed(1)} GB free)`)
          return ssdCacheDir
        }
      }
    }
    
    console.log(`[Whisper] Using default cache directory: ${defaultCacheDir}`)
    return defaultCacheDir
  } catch (error) {
    console.warn(`[Whisper] Failed to detect SSD, using default cache:`, error)
    return defaultCacheDir
  }
}

// Cache directory for models - will be set to SSD if available
let CACHE_DIR = path.join(os.homedir(), '.cache', 'huggingface', 'transformers')

let whisperPipeline: any = null
let isInitializing = false
let initPromise: Promise<any> | null = null
let transformersModule: any = null

/**
 * Dynamically import @xenova/transformers (ES Module)
 */
async function loadTransformers(): Promise<any> {
  if (transformersModule) {
    return transformersModule
  }

  // Dynamic import for ES Module
  transformersModule = await import('@xenova/transformers')
  
  // Configure environment
  transformersModule.env.allowLocalModels = false
  transformersModule.env.allowRemoteModels = true
  
  // Set cache directory to SSD if available (faster model loading)
  try {
    CACHE_DIR = await getOptimalCacheDir()
    // Ensure cache directory exists
    await fsp.mkdir(CACHE_DIR, { recursive: true }).catch(() => {})
    transformersModule.env.cacheDir = CACHE_DIR
    console.log(`[Whisper] ✅ Cache directory set to: ${CACHE_DIR}`)
  } catch (error) {
    console.warn(`[Whisper] Failed to set optimal cache directory:`, error)
  }
  
  // Note: @xenova/transformers in Node.js main process doesn't support WebGPU
  // Navigator is not available in Node.js, so WebGPU detection always fails
  // We'll use explicit CPU device to avoid detection overhead and optimize for CPU performance
  console.log('[Whisper] Using CPU device (Node.js main process - WebGPU not available)')

  return transformersModule
}

/**
 * Initialize Whisper pipeline (lazy loading)
 */
async function getWhisperPipeline(): Promise<any> {
  if (whisperPipeline) {
    return whisperPipeline
  }

  if (isInitializing && initPromise) {
    return initPromise
  }

  isInitializing = true
  initPromise = (async () => {
    try {
      // Load transformers module first
      const transformers = await loadTransformers()
      
      // Use Whisper Small model for best accuracy (vs Tiny/Base)
      // Small model is significantly more accurate than Base/Tiny
      // Model sizes: tiny (~75MB) < base (~150MB) < small (~500MB) < medium (~1.5GB)
      // Small provides excellent accuracy while still being manageable in size
      console.log('[Whisper] Loading Whisper Small model (best accuracy)...')
      console.log(`[Whisper] Cache directory: ${CACHE_DIR}`)
      console.log('[Whisper] Note: Small model is ~500MB, first download may take several minutes')
      
      // Use explicit CPU device - faster than auto-detect overhead in Node.js
      // @xenova/transformers in Node.js main process doesn't support WebGPU/CUDA
      // Explicit CPU setting avoids detection overhead and optimizes for CPU performance
      whisperPipeline = await transformers.pipeline(
        'automatic-speech-recognition',
        'Xenova/whisper-small', // Upgraded to Small for best accuracy and word-level timestamps
        {
          quantized: true, // Use quantized model for smaller size and faster loading
          device: 'cpu', // Explicit CPU - faster than auto-detect overhead
          progress_callback: (progress: any) => {
            if (progress.status === 'progress') {
              console.log(`[Whisper] Downloading model: ${progress.progress || 0}%`)
            }
          },
        }
      )
      
      // Log device info after pipeline creation
      const deviceInfo = whisperPipeline?.processor?.device || whisperPipeline?.model?.device || 'cpu'
      console.log(`[Whisper] ✅ Pipeline created, device: ${deviceInfo}`)
      console.log(`[Whisper] ✅ Using CPU (optimized for Node.js main process)`)
      
      console.log('[Whisper] Model loaded successfully')
      isInitializing = false
      return whisperPipeline
    } catch (error) {
      isInitializing = false
      initPromise = null
      console.error('[Whisper] Failed to load model:', error)
      throw error
    }
  })()

  return initPromise
}

/**
 * Convert audio file to WAV format (required by Whisper)
 */
async function convertAudioToWav(inputPath: string, outputPath: string): Promise<void> {
  const { ffmpeg } = getFfmpegPaths()
  
  return new Promise((resolve, reject) => {
    // Improved audio preprocessing for better Whisper accuracy:
    // - 16kHz sample rate (Whisper requirement)
    // - Mono channel (required)
    // - High-pass filter to remove low-frequency noise
    // - Low-pass filter to remove high-frequency noise
    // - Normalize audio levels for better recognition
    const args = [
      '-i', inputPath,
      '-ar', '16000', // 16kHz sample rate (Whisper requirement)
      '-ac', '1',     // Mono channel
      '-af', 'highpass=f=80,lowpass=f=8000,volume=1.0', // Filter noise and normalize
      '-f', 'wav',    // WAV format
      '-y',           // Overwrite
      outputPath,
    ]

    const proc = spawn(ffmpeg, args, { windowsHide: true })
    let stderr = ''

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
    })

    proc.on('error', (err) => {
      reject(new Error(`FFmpeg error: ${err.message}`))
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`FFmpeg exited with code ${code}. ${stderr.substring(0, 500)}`))
      }
    })
  })
}

/**
 * Transcribe audio file to text using Whisper
 * @param audioPath Path to audio file
 * @param language Language code: 'auto' (auto-detect), 'vi' (Vietnamese), 'en' (English), 'zh' (Chinese), 'ja' (Japanese), 'ko' (Korean), 'th' (Thai), 'fr' (French), 'de' (German), 'es' (Spanish), 'it' (Italian), 'pt' (Portuguese), 'ru' (Russian), 'ar' (Arabic), 'hi' (Hindi), etc. (supports ~99 languages)
 * @param onProgress Progress callback
 * @param returnFullResult If true, returns full result object with timestamps. If false, returns only text string.
 */
export async function transcribeAudio(
  audioPath: string,
  language: string = 'auto',
  onProgress?: (progress: { stage: string; message: string }) => void,
  returnFullResult: boolean = false
): Promise<string | any> {
  // Try GPU path first (Faster-Whisper via Python) unless explicitly disabled.
  const gpuEnv = process.env.WHISPER_GPU_ENABLED
  const tryGpuFirst = gpuEnv === undefined || gpuEnv === '1' || gpuEnv === 'true'

  if (tryGpuFirst) {
    try {
      onProgress?.({
        stage: 'transcribing',
        message: 'Đang nhận diện lời bài hát bằng GPU (Faster-Whisper)...',
      })

      const gpuResult = await transcribeWithFasterWhisper({
        audioPath,
        language,
      })

      console.log('[Whisper] ✅ Using Faster-Whisper GPU result')

      if (returnFullResult) {
        return gpuResult
      }

      return gpuResult.text || ''
    } catch (error) {
      console.warn(
        '[Whisper] ⚠️ Faster-Whisper GPU path failed, falling back to CPU implementation:',
        error
      )
      // Fall through to CPU implementation
    }
  }

  try {
    onProgress?.({ stage: 'converting', message: 'Đang chuyển đổi audio sang WAV (CPU)...' })

    // Convert audio to WAV format
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'whisper-'))
    const wavPath = path.join(tempDir, 'audio.wav')

    try {
      await convertAudioToWav(audioPath, wavPath)
    } catch (error) {
      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})
      throw new Error(`Failed to convert audio: ${error instanceof Error ? error.message : String(error)}`)
    }

    onProgress?.({ stage: 'loading', message: 'Đang tải Whisper model (lần đầu có thể mất vài phút)...' })

    // Load Whisper pipeline
    const pipeline = await getWhisperPipeline()

    onProgress?.({ stage: 'transcribing', message: 'Đang nhận diện lời bài hát...' })

    // Read audio file as buffer and convert to format Whisper expects
    // Whisper expects raw audio data (PCM), not WAV file directly
    // We need to extract PCM data from WAV file
    const wavBuffer = await fs.promises.readFile(wavPath)
    
    // WAV file structure: header (44 bytes) + PCM data
    // Skip WAV header (first 44 bytes) to get raw PCM data
    const pcmData = wavBuffer.subarray(44)
    
    // Convert buffer to Float32Array (Whisper expects Float32Array)
    const float32Array = new Float32Array(pcmData.length / 2) // 16-bit = 2 bytes per sample
    for (let i = 0; i < float32Array.length; i++) {
      // Convert 16-bit PCM to float32 (-1.0 to 1.0)
      const sample = pcmData.readInt16LE(i * 2)
      float32Array[i] = sample / 32768.0
    }

    // Transcribe with timestamps for subtitle generation
    // Whisper supports ~99 languages. Use 'auto' to auto-detect, or specify language code
    // Common codes: 'vi' (Vietnamese), 'en' (English), 'zh' (Chinese), 'ja' (Japanese), 
    // 'ko' (Korean), 'th' (Thai), 'fr' (French), 'de' (German), 'es' (Spanish), 
    // 'it' (Italian), 'pt' (Portuguese), 'ru' (Russian), 'ar' (Arabic), 'hi' (Hindi)
    
    // ALWAYS request word-level timestamps for professional karaoke effects
    // 'word' = word-level timestamps (best for karaoke)
    // true = segment-level timestamps (less precise)
    
    // Improved accuracy settings for Whisper Base model:
    // - Lower temperature for more deterministic output
    // - Adjust no_speech_threshold to reduce hallucinations
    // - Use condition_on_previous_text for better context
    const result = await pipeline(float32Array, {
      return_timestamps: returnFullResult ? 'word' : 'word', // ALWAYS use word-level for better karaoke
      language: language === 'auto' ? null : language, // null = auto-detect, otherwise use specified language
      task: 'transcribe',
      chunk_length_s: 30, // Process in 30-second chunks
      // Improved accuracy options (supported by @xenova/transformers)
      temperature: 0, // Deterministic output (0 = most deterministic, reduces hallucinations)
      no_speech_threshold: 0.5, // Lower threshold (0.5) to reduce hallucinations in silent parts
      // Note: condition_on_previous_text, compression_ratio_threshold, logprob_threshold
      // may not be supported by @xenova/transformers, so we only use basic options
    })
    
    // Log result structure for debugging
    console.log(`[Whisper] Result type: ${typeof result}`)
    console.log(`[Whisper] Result has text: ${!!result?.text}`)
    console.log(`[Whisper] Result has chunks: ${!!result?.chunks}`)
    if (result?.chunks && Array.isArray(result.chunks)) {
      console.log(`[Whisper] Chunks count: ${result.chunks.length}`)
      if (result.chunks.length > 0) {
        const firstChunk = result.chunks[0]
        console.log(`[Whisper] First chunk has words: ${!!firstChunk?.words}`)
        console.log(`[Whisper] First chunk words count: ${firstChunk?.words?.length || 0}`)
      }
    }

    // Cleanup temp file
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})

    const text = result?.text || ''
    
    if (!text.trim()) {
      throw new Error('Whisper không nhận diện được lời bài hát')
    }

    onProgress?.({ stage: 'done', message: 'Hoàn tất nhận diện lời bài hát' })

    // Return full result with timestamps if requested, otherwise return text only
    if (returnFullResult) {
      return result
    }

    return text.trim()
  } catch (error) {
    console.error('[Whisper] Transcription error:', error)
    throw error
  }
}

/**
 * Check if Whisper is available (model can be loaded)
 */
export async function checkWhisperAvailable(): Promise<boolean> {
  try {
    await getWhisperPipeline()
    return true
  } catch (error) {
    console.warn('[Whisper] Not available:', error)
    return false
  }
}

/**
 * Get cache directory size (for cleanup if needed)
 */
export function getWhisperCacheSize(): Promise<number> {
  return new Promise((resolve) => {
    if (!fs.existsSync(CACHE_DIR)) {
      resolve(0)
      return
    }

    let totalSize = 0
    const walk = (dir: string) => {
      try {
        const files = fs.readdirSync(dir)
        for (const file of files) {
          const filePath = path.join(dir, file)
          const stat = fs.statSync(filePath)
          if (stat.isDirectory()) {
            walk(filePath)
          } else {
            totalSize += stat.size
          }
        }
      } catch (error) {
        // Ignore errors
      }
    }

    walk(CACHE_DIR)
    resolve(totalSize)
  })
}

