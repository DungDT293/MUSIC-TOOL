import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
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

vi.mock('../../../backend/utils/gpuDetection', () => ({
  clearGpuCache: vi.fn(),
  getGpuInfo: vi.fn(async () => ({
    available: true,
    encoder: 'nvenc',
    name: 'Mock GPU',
    reason: 'mock',
    ffmpegProfile: 'modern',
    ffmpegPath: '/mock/ffmpeg',
  })),
  buildVideoEncoderArgsWithChoice: vi.fn(async () => ({
    usedEncoder: 'gpu',
    args: ['-hwaccel', 'nvdec', '-c:v', 'h264_nvenc', '-pix_fmt', 'yuv420p', '-vsync', '2'],
  })),
}))

import { spawn } from 'node:child_process'
import { getGpuInfo } from '../../../backend/utils/gpuDetection'
import { runAutopilotHealthCheck } from '../../../backend/autopilot/healthCheck'

function makeFakeChild(exitCode: number) {
  const child = new EventEmitter() as any
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()

  setTimeout(() => {
    child.emit('close', exitCode)
  }, 0)

  return child
}

describe('runAutopilotHealthCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.FFMPEG_GPU_PROFILE = 'auto'
    delete process.env.FFMPEG_GPU_LEGACY_PATH
    delete process.env.FFPROBE_GPU_LEGACY_PATH
    vi.mocked(spawn).mockImplementation((_command: string, _args: string[]) => makeFakeChild(0) as any)
  })

  it('uses the configured GPU smoke test size instead of a tiny invalid NVENC frame', async () => {
    const result = await runAutopilotHealthCheck({
      dayPlans: [
        {
          id: 'day-1',
          dateCode: '1004',
          playlistCount: 1,
          minutesPerPlaylist: 60,
          presetId: 'tomorrowland',
          overrides: {
            normalizeVideoInput: true,
          },
        },
      ],
      folders: {
        rootAudio: 'E:\\audio',
        rootVideo: 'E:\\video',
        rootFinal: 'E:\\final',
        autoCreateDailySubfolder: true,
      },
    })

    expect(result.ok).toBe(true)
    expect(result.recommendedUseGpuEncoding).toBe('gpu')

    const gpuSmokeTestCall = vi.mocked(spawn).mock.calls[4]
    expect(gpuSmokeTestCall).toBeTruthy()
    expect(gpuSmokeTestCall?.[1]).toContain('color=c=black:s=320x180:r=30')
    expect(gpuSmokeTestCall?.[1]).not.toContain('color=c=black:s=64x64:r=30')
  })

  it('fails fast when batch requires GPU but no usable GPU encoder is detected', async () => {
    vi.mocked(getGpuInfo).mockResolvedValueOnce({
      available: false,
      encoder: 'cpu',
      reason: 'Legacy GPU FFmpeg profile not found',
    } as any)

    const result = await runAutopilotHealthCheck({
      dayPlans: [
        {
          id: 'day-1',
          dateCode: '1004',
          playlistCount: 1,
          minutesPerPlaylist: 60,
          presetId: 'tomorrowland',
          overrides: {
            normalizeVideoInput: true,
          },
        },
      ],
      folders: {
        rootAudio: 'E:\\audio',
        rootVideo: 'E:\\video',
        rootFinal: 'E:\\final',
        autoCreateDailySubfolder: true,
      },
      runtimeOverrides: {
        requireGpuForVideoEncode: true,
      },
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('GPU encoder was requested but no usable GPU encoder was detected')
    expect(result.error).toContain('khong duoc phep roi ve CPU')
  })

  it('reports resolved legacy metadata and notice when auto falls back to legacy successfully', async () => {
    vi.mocked(getGpuInfo).mockResolvedValueOnce({
      available: true,
      encoder: 'nvenc',
      name: 'Legacy GPU',
      reason: 'NVENC encoder detected and smoke test passed via legacy profile after auto fallback from modern due to old NVIDIA driver/API mismatch',
      ffmpegProfile: 'legacy',
      ffmpegPath: '/mock/ffmpeg-legacy',
      ffprobePath: '/mock/ffprobe-legacy',
    } as any)

    const result = await runAutopilotHealthCheck({
      dayPlans: [
        {
          id: 'day-1',
          dateCode: '1004',
          playlistCount: 1,
          minutesPerPlaylist: 60,
          presetId: 'tomorrowland',
          overrides: {
            normalizeVideoInput: true,
          },
        },
      ],
      folders: {
        rootAudio: 'E:\\audio',
        rootVideo: 'E:\\video',
        rootFinal: 'E:\\final',
        autoCreateDailySubfolder: true,
      },
      runtimeOverrides: {
        finalExportUseGpuEncoding: 'auto',
      },
    })

    expect(result.ok).toBe(true)
    expect(result.noticeLevel).toBe('info')
    expect(result.notice).toContain('passed via legacy profile')
    expect(result.notice).toContain('Auto da resolve sang Legacy GPU profile')
    expect(result.resolvedGpuProfile).toBe('legacy')
    expect(result.resolvedGpuFfmpegPath).toBe('/mock/ffmpeg-legacy')
    expect(result.resolvedGpuEncoder).toBe('nvenc')
  })

  it('keeps legacy hint when auto detection reports old-driver incompatibility without usable GPU', async () => {
    process.env.FFMPEG_GPU_LEGACY_PATH = '/missing/ffmpeg-legacy'
    process.env.FFPROBE_GPU_LEGACY_PATH = '/missing/ffprobe-legacy'
    vi.mocked(getGpuInfo).mockResolvedValueOnce({
      available: false,
      encoder: 'cpu',
      reason:
        'Auto GPU detect: modern profile appears incompatible with the current NVIDIA driver/API. Legacy GPU FFmpeg profile not found. [modern] NVENC encoder detected but smoke test failed: exit code 1. stderr: Driver does not support the required nvenc API version',
    } as any)

    const result = await runAutopilotHealthCheck({
      dayPlans: [
        {
          id: 'day-1',
          dateCode: '1004',
          playlistCount: 1,
          minutesPerPlaylist: 60,
          presetId: 'tomorrowland',
          overrides: {
            normalizeVideoInput: true,
          },
        },
      ],
      folders: {
        rootAudio: 'E:\\audio',
        rootVideo: 'E:\\video',
        rootFinal: 'E:\\final',
        autoCreateDailySubfolder: true,
      },
      runtimeOverrides: {
        finalExportUseGpuEncoding: 'auto',
      },
    })

    expect(result.ok).toBe(true)
    expect(result.recommendedUseGpuEncoding).toBe('cpu')
    expect(result.notice).toContain('GPU encoder not ready')
    expect(result.notice).toContain('vao Settings > FFmpeg GPU va chon file ffmpeg.exe cua bo legacy')
  })

  it('still fails when GPU is mandatory and auto cannot resolve to a usable profile', async () => {
    vi.mocked(getGpuInfo).mockResolvedValueOnce({
      available: false,
      encoder: 'cpu',
      reason:
        'Auto GPU detect: modern profile appears incompatible with the current NVIDIA driver/API. Legacy profile was also tried but is not usable. [modern] NVENC encoder detected but smoke test failed: exit code 1. stderr: Driver does not support the required nvenc API version | [legacy] NVENC encoder detected but smoke test failed: exit code 1. stderr: Driver does not support the required nvenc API version',
    } as any)

    const result = await runAutopilotHealthCheck({
      dayPlans: [
        {
          id: 'day-1',
          dateCode: '1004',
          playlistCount: 1,
          minutesPerPlaylist: 60,
          presetId: 'tomorrowland',
          overrides: {
            normalizeVideoInput: true,
          },
        },
      ],
      folders: {
        rootAudio: 'E:\\audio',
        rootVideo: 'E:\\video',
        rootFinal: 'E:\\final',
        autoCreateDailySubfolder: true,
      },
      runtimeOverrides: {
        finalExportUseGpuEncoding: 'auto',
        requireGpuForVideoEncode: true,
      },
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('GPU encoder was requested but no usable GPU encoder was detected')
    expect(result.error).toContain('khong duoc phep roi ve CPU')
  })
})
