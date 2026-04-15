import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
  },
}))

vi.mock('../../../backend/ffmpeg/config', () => ({
  getFfmpegPaths: vi.fn(() => ({ ffmpeg: '/mock/ffmpeg', ffprobe: '/mock/ffprobe' })),
}))

import { spawn } from 'child_process'
import fs from 'node:fs'
import { buildVideoEncoderArgsWithChoice, clearGpuCache, getGpuInfo } from '../../../backend/utils/gpuDetection'

const OLD_DRIVER_STDERR =
  '[h264_nvenc] Driver does not support the required nvenc API version. Required: 13.0 Found: 12.2\n' +
  '[h264_nvenc] The minimum required Nvidia driver for nvenc is 570.0 or newer\n'

function makeFakeChild(
  exitCode: number,
  streams: { stdout?: string; stderr?: string } = {},
) {
  const child = new EventEmitter() as any
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.killed = false
  child.kill = vi.fn(() => {
    child.killed = true
    return true
  })

  setTimeout(() => {
    if (streams.stdout) child.stdout.emit('data', Buffer.from(streams.stdout))
    if (streams.stderr) child.stderr.emit('data', Buffer.from(streams.stderr))
    child.emit('close', exitCode)
  }, 0)

  return child
}

describe('gpuDetection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearGpuCache()
    process.env.FFMPEG_GPU_PROFILE = 'auto'
    delete process.env.FFMPEG_GPU_LEGACY_PATH
    delete process.env.FFPROBE_GPU_LEGACY_PATH
    delete process.env.FFMPEG_GPU_MODERN_PATH
    delete process.env.FFPROBE_GPU_MODERN_PATH
    vi.mocked(fs.existsSync).mockImplementation((filePath: any) => {
      const value = String(filePath)
      return !value.includes('ffmpeg-legacy') && !value.includes('ffprobe-legacy')
    })
  })

  it('falls back to CPU when NVENC is listed but smoke test fails on old drivers', async () => {
    vi.mocked(spawn)
      .mockImplementationOnce(() =>
        makeFakeChild(0, { stdout: ' V..... h264_nvenc           NVIDIA NVENC H.264 encoder\n' }) as any,
      )
      .mockImplementationOnce(() => makeFakeChild(1, { stderr: OLD_DRIVER_STDERR }) as any)

    const info = await getGpuInfo()

    expect(info).toMatchObject({
      encoder: 'cpu',
      available: false,
    })
    expect(info.reason).toContain('Auto GPU detect: modern profile appears incompatible')
    expect(info.reason).toContain('NVENC encoder detected but smoke test failed')
    expect(info.reason).toContain('minimum required Nvidia driver')
    expect(info.reason).toContain('Legacy GPU FFmpeg profile not found')
  })

  it('buildVideoEncoderArgsWithChoice uses CPU when cached GPU detection found unusable NVENC', async () => {
    vi.mocked(spawn)
      .mockImplementationOnce(() =>
        makeFakeChild(0, { stdout: ' V..... h264_nvenc           NVIDIA NVENC H.264 encoder\n' }) as any,
      )
      .mockImplementationOnce(() =>
        makeFakeChild(1, {
          stderr:
            '[h264_nvenc] Driver does not support the required nvenc API version. Required: 13.0 Found: 12.2\n',
        }) as any,
      )

    const result = await buildVideoEncoderArgsWithChoice(true, 'auto', 'fast')

    expect(result.usedEncoder).toBe('cpu')
    expect(result.args).toContain('libx264')
  })

  it('auto profile falls back from modern to legacy GPU binary when legacy smoke test passes', async () => {
    process.env.FFMPEG_GPU_LEGACY_PATH = '/mock/ffmpeg-legacy'
    process.env.FFPROBE_GPU_LEGACY_PATH = '/mock/ffprobe-legacy'
    vi.mocked(fs.existsSync).mockImplementation(() => true)

    vi.mocked(spawn)
      .mockImplementationOnce(() =>
        makeFakeChild(0, { stdout: ' V..... h264_nvenc           NVIDIA NVENC H.264 encoder\n' }) as any,
      )
      .mockImplementationOnce(() => makeFakeChild(1, { stderr: OLD_DRIVER_STDERR }) as any)
      .mockImplementationOnce(() =>
        makeFakeChild(0, { stdout: ' V..... h264_nvenc           NVIDIA NVENC H.264 encoder\n' }) as any,
      )
      .mockImplementationOnce(() => makeFakeChild(0) as any)
      .mockImplementationOnce(() => makeFakeChild(0, { stdout: 'Legacy GPU\n' }) as any)

    const info = await getGpuInfo()

    expect(info.available).toBe(true)
    expect(info.encoder).toBe('nvenc')
    expect(info.ffmpegProfile).toBe('legacy')
    expect(info.ffmpegPath).toContain('ffmpeg-legacy')
    expect(info.reason).toContain('legacy profile')
    expect(info.reason).toContain('after auto fallback from modern due to old NVIDIA driver/API mismatch')
  })

  it('modern profile does not silently fall back to legacy when old-driver NVENC smoke test fails', async () => {
    process.env.FFMPEG_GPU_LEGACY_PATH = '/mock/ffmpeg-legacy'
    process.env.FFPROBE_GPU_LEGACY_PATH = '/mock/ffprobe-legacy'
    vi.mocked(fs.existsSync).mockImplementation(() => true)

    vi.mocked(spawn)
      .mockImplementationOnce(() =>
        makeFakeChild(0, { stdout: ' V..... h264_nvenc           NVIDIA NVENC H.264 encoder\n' }) as any,
      )
      .mockImplementationOnce(() => makeFakeChild(1, { stderr: OLD_DRIVER_STDERR }) as any)

    const info = await getGpuInfo('modern')

    expect(info).toMatchObject({
      encoder: 'cpu',
      available: false,
    })
    expect(info.reason).toContain('[modern]')
    expect(info.reason).not.toContain('legacy profile was also tried')
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(2)
  })

  it('legacy profile uses the legacy FFmpeg pair directly when available', async () => {
    process.env.FFMPEG_GPU_LEGACY_PATH = '/mock/ffmpeg-legacy'
    process.env.FFPROBE_GPU_LEGACY_PATH = '/mock/ffprobe-legacy'
    vi.mocked(fs.existsSync).mockImplementation(() => true)

    vi.mocked(spawn)
      .mockImplementationOnce(() =>
        makeFakeChild(0, { stdout: ' V..... h264_nvenc           NVIDIA NVENC H.264 encoder\n' }) as any,
      )
      .mockImplementationOnce(() => makeFakeChild(0) as any)
      .mockImplementationOnce(() => makeFakeChild(0, { stdout: 'Legacy GPU\n' }) as any)

    const info = await getGpuInfo('legacy')

    expect(info.available).toBe(true)
    expect(info.encoder).toBe('nvenc')
    expect(info.ffmpegProfile).toBe('legacy')
    expect(info.ffmpegPath).toBe('/mock/ffmpeg-legacy')
    expect(info.reason).toContain('legacy profile')
    expect(info.reason).not.toContain('after auto fallback')
  })

  it('keeps detection cache isolated per GPU FFmpeg profile', async () => {
    process.env.FFMPEG_GPU_LEGACY_PATH = '/mock/ffmpeg-legacy'
    process.env.FFPROBE_GPU_LEGACY_PATH = '/mock/ffprobe-legacy'
    vi.mocked(fs.existsSync).mockImplementation(() => true)

    vi.mocked(spawn)
      .mockImplementationOnce(() =>
        makeFakeChild(0, { stdout: ' V..... h264_nvenc           NVIDIA NVENC H.264 encoder\n' }) as any,
      )
      .mockImplementationOnce(() => makeFakeChild(1, { stderr: OLD_DRIVER_STDERR }) as any)
      .mockImplementationOnce(() =>
        makeFakeChild(0, { stdout: ' V..... h264_nvenc           NVIDIA NVENC H.264 encoder\n' }) as any,
      )
      .mockImplementationOnce(() => makeFakeChild(1, { stderr: OLD_DRIVER_STDERR }) as any)
      .mockImplementationOnce(() =>
        makeFakeChild(0, { stdout: ' V..... h264_nvenc           NVIDIA NVENC H.264 encoder\n' }) as any,
      )
      .mockImplementationOnce(() => makeFakeChild(0) as any)
      .mockImplementationOnce(() => makeFakeChild(0, { stdout: 'Legacy GPU\n' }) as any)

    const modernInfo = await getGpuInfo('modern')
    const autoInfo = await getGpuInfo('auto')

    expect(modernInfo.available).toBe(false)
    expect(autoInfo.available).toBe(true)
    expect(autoInfo.ffmpegProfile).toBe('legacy')
    expect(autoInfo.reason).toContain('after auto fallback from modern due to old NVIDIA driver/API mismatch')
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(7)
  })
})
