/**
 * GPU Detection and Encoder Selection
 * Detects available GPU hardware and selects optimal encoder for FFmpeg
 */

import { spawn } from 'child_process'
import { getFfmpegPaths } from '../ffmpeg/config'
import fs from 'node:fs'

export type GpuEncoder = 'nvenc' | 'amf' | 'videotoolbox' | 'cpu'

export interface GpuInfo {
  encoder: GpuEncoder
  available: boolean
  name?: string
  reason?: string
}

let cachedGpuInfo: GpuInfo | null = null

/**
 * Detect GPU encoder availability using FFmpeg
 * Has timeout to prevent app freezing
 */
async function detectGpuEncoder(): Promise<GpuInfo> {
  const { ffmpeg } = getFfmpegPaths()
  if (!ffmpeg || !fs.existsSync(ffmpeg)) {
    return { encoder: 'cpu', available: false, reason: 'FFmpeg not found' }
  }

  return new Promise((resolve) => {
    let resolved = false
    const TIMEOUT_MS = 5000 // 5 seconds timeout
    let testNvencProcess: ReturnType<typeof spawn> | null = null
    let nvidiaSmiProcess: ReturnType<typeof spawn> | null = null
    
    // Timeout handler - fallback to CPU if detection takes too long
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true
        // Kill processes if still running
        if (testNvencProcess && !testNvencProcess.killed) {
          try {
            testNvencProcess.kill('SIGTERM')
            setTimeout(() => {
              if (testNvencProcess && !testNvencProcess.killed) {
                testNvencProcess.kill('SIGKILL')
              }
            }, 1000)
          } catch (e) {
            // Ignore kill errors
          }
        }
        if (nvidiaSmiProcess && !nvidiaSmiProcess.killed) {
          try {
            nvidiaSmiProcess.kill('SIGTERM')
            setTimeout(() => {
              if (nvidiaSmiProcess && !nvidiaSmiProcess.killed) {
                nvidiaSmiProcess.kill('SIGKILL')
              }
            }, 1000)
          } catch (e) {
            // Ignore kill errors
          }
        }
        console.warn('[GPU Detection] Timeout after 5s, falling back to CPU encoder')
        resolve({
          encoder: 'cpu',
          available: false,
          reason: 'GPU detection timeout, using CPU (libx264)',
        })
      }
    }, TIMEOUT_MS)

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId)
    }

    // Test NVENC (NVIDIA GPU)
    testNvencProcess = spawn(ffmpeg, ['-hide_banner', '-encoders'], { windowsHide: true })
    let nvencOutput = ''
    
    testNvencProcess.stdout?.on('data', (chunk) => {
      nvencOutput += chunk.toString('utf-8')
    })
    testNvencProcess.stderr?.on('data', (chunk) => {
      nvencOutput += chunk.toString('utf-8')
    })
    
    testNvencProcess.on('close', (code) => {
      if (resolved) return
      
      cleanup()
      const hasNvenc = /h264_nvenc|hevc_nvenc/i.test(nvencOutput)
      const hasAmf = /h264_amf|hevc_amf/i.test(nvencOutput)
      const hasVideoToolbox = /h264_videotoolbox|hevc_videotoolbox/i.test(nvencOutput)

      if (hasNvenc) {
        // Try to get GPU name from nvidia-smi (if available) - with timeout
        const nvidiaSmiTimeout = setTimeout(() => {
          if (!resolved) {
            resolved = true
            resolve({
              encoder: 'nvenc',
              available: true,
              name: 'NVIDIA GPU',
              reason: 'NVENC encoder detected (nvidia-smi timeout)',
            })
          }
        }, 2000) // 2s timeout for nvidia-smi

        nvidiaSmiProcess = spawn('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], { windowsHide: true })
        let gpuName = ''
        
        nvidiaSmiProcess.stdout?.on('data', (chunk) => {
          gpuName += chunk.toString('utf-8').trim()
        })
        
        nvidiaSmiProcess.on('close', () => {
          if (resolved) return
          clearTimeout(nvidiaSmiTimeout)
          resolved = true
          resolve({
            encoder: 'nvenc',
            available: true,
            name: gpuName || 'NVIDIA GPU',
            reason: 'NVENC encoder detected',
          })
        })
        
        nvidiaSmiProcess.on('error', () => {
          if (resolved) return
          clearTimeout(nvidiaSmiTimeout)
          resolved = true
          resolve({
            encoder: 'nvenc',
            available: true,
            name: 'NVIDIA GPU',
            reason: 'NVENC encoder detected (nvidia-smi not available)',
          })
        })
        return
      }

      if (hasAmf) {
        resolved = true
        resolve({
          encoder: 'amf',
          available: true,
          name: 'AMD GPU',
          reason: 'AMF encoder detected',
        })
        return
      }

      if (hasVideoToolbox) {
        resolved = true
        resolve({
          encoder: 'videotoolbox',
          available: true,
          name: 'Apple GPU',
          reason: 'VideoToolbox encoder detected',
        })
        return
      }

      // Fallback to CPU
      resolved = true
      resolve({
        encoder: 'cpu',
        available: false,
        reason: 'No GPU encoder found, using CPU (libx264)',
      })
    })
    
    testNvencProcess.on('error', () => {
      if (resolved) return
      cleanup()
      resolved = true
      resolve({
        encoder: 'cpu',
        available: false,
        reason: 'Failed to detect GPU encoder',
      })
    })
  })
}

/**
 * Get GPU info (cached)
 */
export async function getGpuInfo(): Promise<GpuInfo> {
  if (cachedGpuInfo) {
    console.log(`[getGpuInfo] Using cached GPU info:`, cachedGpuInfo)
    return cachedGpuInfo
  }

  console.log(`[getGpuInfo] Detecting GPU encoder...`)
  cachedGpuInfo = await detectGpuEncoder()
  console.log(`[getGpuInfo] GPU detection result:`, cachedGpuInfo)
  return cachedGpuInfo
}

/**
 * Build FFmpeg video encoder args based on GPU availability
 */
export async function buildVideoEncoderArgs(
  needsReencode: boolean,
  quality: 'fast' | 'medium' | 'slow' = 'fast'
): Promise<string[]> {
  if (!needsReencode) {
    return ['-c:v', 'copy']
  }

  const gpuInfo = await getGpuInfo()

  if (gpuInfo.encoder === 'nvenc' && gpuInfo.available) {
    // NVIDIA NVENC - very fast, good quality
    const preset = quality === 'fast' ? 'p1' : quality === 'medium' ? 'p4' : 'p6' // p1 = fastest, p7 = slowest
    const crf = quality === 'fast' ? '23' : quality === 'medium' ? '21' : '19' // Lower = better quality
    return [
      '-c:v',
      'h264_nvenc',
      '-preset',
      preset,
      '-rc',
      'vbr',
      '-cq',
      crf,
      '-b:v',
      '0', // Let CQ control bitrate
      '-pix_fmt',
      'yuv420p',
      '-vsync',
      '2',
    ]
  }

  if (gpuInfo.encoder === 'amf' && gpuInfo.available) {
    // AMD AMF - fast, good quality
    const qualityPreset = quality === 'fast' ? 'speed' : quality === 'medium' ? 'balanced' : 'quality'
    return [
      '-c:v',
      'h264_amf',
      '-quality',
      qualityPreset,
      '-rc',
      'vbr_peak',
      '-qmin',
      '18',
      '-qmax',
      '28',
      '-pix_fmt',
      'yuv420p',
      '-vsync',
      '2',
    ]
  }

  if (gpuInfo.encoder === 'videotoolbox' && gpuInfo.available) {
    // Apple VideoToolbox - fast on macOS
    return [
      '-c:v',
      'h264_videotoolbox',
      '-b:v',
      quality === 'fast' ? '8M' : quality === 'medium' ? '12M' : '16M',
      '-pix_fmt',
      'yuv420p',
      '-vsync',
      '2',
    ]
  }

  // Fallback to CPU (libx264)
  const preset = quality === 'fast' ? 'veryfast' : quality === 'medium' ? 'medium' : 'slow'
  const crf = quality === 'fast' ? '23' : quality === 'medium' ? '21' : '19'
  return ['-c:v', 'libx264', '-preset', preset, '-crf', crf, '-pix_fmt', 'yuv420p', '-vsync', '2']
}

/**
 * Build FFmpeg video encoder args with user choice (GPU/CPU/Auto)
 * @param needsReencode - Whether re-encoding is needed
 * @param userChoice - User's choice: 'gpu' (prefer GPU), 'cpu' (force CPU), 'auto' (auto-detect)
 * @param quality - Quality preset: 'fast', 'medium', 'slow'
 * @returns Object with encoder args, used encoder type, and GPU info (if GPU used)
 */
export async function buildVideoEncoderArgsWithChoice(
  needsReencode: boolean,
  userChoice: 'gpu' | 'cpu' | 'auto' = 'auto',
  quality: 'fast' | 'medium' | 'slow' = 'fast'
): Promise<{ args: string[], usedEncoder: 'gpu' | 'cpu', gpuInfo?: GpuInfo }> {
  if (!needsReencode) {
    return { args: ['-c:v', 'copy'], usedEncoder: 'cpu' }
  }

  // If user explicitly wants CPU, use CPU
  if (userChoice === 'cpu') {
    const preset = quality === 'fast' ? 'veryfast' : quality === 'medium' ? 'medium' : 'slow'
    const crf = quality === 'fast' ? '23' : quality === 'medium' ? '21' : '19'
    return {
      args: ['-c:v', 'libx264', '-preset', preset, '-crf', crf, '-pix_fmt', 'yuv420p', '-vsync', '2'],
      usedEncoder: 'cpu',
    }
  }

  // Get GPU info
  const gpuInfo = await getGpuInfo()
  console.log(`[buildVideoEncoderArgsWithChoice] userChoice=${userChoice}, gpuInfo:`, {
    encoder: gpuInfo.encoder,
    available: gpuInfo.available,
    name: gpuInfo.name,
    reason: gpuInfo.reason,
  })

  // If user wants GPU but GPU not available, fallback to CPU with warning
  if (userChoice === 'gpu' && !gpuInfo.available) {
    console.warn(`[GPU Detection] ⚠️ User requested GPU encoding but GPU not available (${gpuInfo.reason}), falling back to CPU`)
    const preset = quality === 'fast' ? 'veryfast' : quality === 'medium' ? 'medium' : 'slow'
    const crf = quality === 'fast' ? '23' : quality === 'medium' ? '21' : '19'
    return {
      args: ['-c:v', 'libx264', '-preset', preset, '-crf', crf, '-pix_fmt', 'yuv420p', '-vsync', '2'],
      usedEncoder: 'cpu',
    }
  }

  // Use GPU if available (either user requested GPU or auto-detect found GPU)
  if (gpuInfo.available && (userChoice === 'gpu' || userChoice === 'auto')) {
    if (gpuInfo.encoder === 'nvenc') {
      // NVIDIA NVENC - Add hardware acceleration for input decoding (NVDEC)
      const preset = quality === 'fast' ? 'p1' : quality === 'medium' ? 'p4' : 'p6'
      const crf = quality === 'fast' ? '23' : quality === 'medium' ? '21' : '19'
      return {
        args: [
          // Hardware acceleration for input decoding (NVDEC)
          // Use 'nvdec' or 'cuda' - both work, but 'nvdec' is more explicit
          '-hwaccel',
          'nvdec',
          // GPU encoder (NVENC)
          '-c:v',
          'h264_nvenc',
          '-preset',
          preset,
          '-rc',
          'vbr',
          '-cq',
          crf,
          '-b:v',
          '0',
          '-gpu',
          '0', // Use first GPU (0 = first GPU, 1 = second GPU, etc.)
          '-pix_fmt',
          'yuv420p',
          '-vsync',
          '2',
        ],
        usedEncoder: 'gpu',
        gpuInfo,
      }
    }

    if (gpuInfo.encoder === 'amf') {
      // AMD AMF - Add hardware acceleration for input decoding
      const qualityPreset = quality === 'fast' ? 'speed' : quality === 'medium' ? 'balanced' : 'quality'
      return {
        args: [
          // Hardware acceleration for input decoding (AMD)
          '-hwaccel',
          'd3d11va',
          // GPU encoder (AMF)
          '-c:v',
          'h264_amf',
          '-quality',
          qualityPreset,
          '-rc',
          'vbr_peak',
          '-qmin',
          '18',
          '-qmax',
          '28',
          '-pix_fmt',
          'yuv420p',
          '-vsync',
          '2',
        ],
        usedEncoder: 'gpu',
        gpuInfo,
      }
    }

    if (gpuInfo.encoder === 'videotoolbox') {
      // Apple VideoToolbox
      return {
        args: [
          '-c:v',
          'h264_videotoolbox',
          '-b:v',
          quality === 'fast' ? '8M' : quality === 'medium' ? '12M' : '16M',
          '-pix_fmt',
          'yuv420p',
          '-vsync',
          '2',
        ],
        usedEncoder: 'gpu',
        gpuInfo,
      }
    }
  }

  // Fallback to CPU (either no GPU available or auto-detect didn't find GPU)
  const preset = quality === 'fast' ? 'veryfast' : quality === 'medium' ? 'medium' : 'slow'
  const crf = quality === 'fast' ? '23' : quality === 'medium' ? '21' : '19'
  return {
    args: ['-c:v', 'libx264', '-preset', preset, '-crf', crf, '-pix_fmt', 'yuv420p', '-vsync', '2'],
    usedEncoder: 'cpu',
  }
}

/**
 * Clear GPU cache (useful for re-detection)
 */
export function clearGpuCache(): void {
  cachedGpuInfo = null
}

