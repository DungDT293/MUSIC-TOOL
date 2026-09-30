import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../backend/video/videoInfo', () => ({
  getVideoFileInfo: vi.fn(),
}))

import { getVideoFileInfo } from '../../../backend/video/videoInfo'
import { validateInputFiles } from '../../../backend/video/videoUtils'

describe('validateInputFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts a file only when it has usable duration and a video stream', async () => {
    vi.mocked(getVideoFileInfo).mockResolvedValue({
      filePath: 'C:/videos/clip.mp4',
      durationSec: 12.5,
      width: 1920,
      height: 1080,
      codecName: 'h264',
      fps: 29.97,
      sizeBytes: 123456,
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
      bitrateBps: 8000000,
    })

    const result = await validateInputFiles(['C:/videos/clip.mp4'], 1)

    expect(result.invalid).toEqual([])
    expect(result.valid).toEqual([
      {
        path: 'C:/videos/clip.mp4',
        durationSec: 12.5,
        width: 1920,
        height: 1080,
        codecName: 'h264',
        fps: 29.97,
        sizeBytes: 123456,
      },
    ])
  })

  it('rejects duration-only files that do not expose a usable video stream', async () => {
    vi.mocked(getVideoFileInfo).mockResolvedValue({
      filePath: 'C:/videos/audio-only.mp4',
      durationSec: 180,
      width: null,
      height: null,
      codecName: null,
      fps: null,
      sizeBytes: 654321,
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
      bitrateBps: 256000,
    })

    const result = await validateInputFiles(['C:/videos/audio-only.mp4'], 1)

    expect(result.valid).toEqual([])
    expect(result.invalid).toEqual(['C:/videos/audio-only.mp4'])
    expect(result.invalidDetails).toEqual([
      {
        path: 'C:/videos/audio-only.mp4',
        reason: 'Video không có stream hình ảnh hợp lệ (thiếu width/height/codec).',
      },
    ])
  })

  it('rejects files with non-positive duration even if dimensions exist', async () => {
    vi.mocked(getVideoFileInfo).mockResolvedValue({
      filePath: 'C:/videos/broken.mp4',
      durationSec: 0,
      width: 1280,
      height: 720,
      codecName: 'h264',
      fps: 30,
      sizeBytes: 100,
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
      bitrateBps: 1000,
    })

    const result = await validateInputFiles(['C:/videos/broken.mp4'], 1)

    expect(result.valid).toEqual([])
    expect(result.invalid).toEqual(['C:/videos/broken.mp4'])
    expect(result.invalidDetails[0]?.reason).toContain('duration hợp lệ')
  })

  it('keeps probe failure reason with exact video path', async () => {
    vi.mocked(getVideoFileInfo).mockRejectedValue(new Error('ffprobe timeout'))

    const result = await validateInputFiles(['E:/nguon/clip loi.mp4'], 1)

    expect(result.valid).toEqual([])
    expect(result.invalidDetails).toEqual([
      {
        path: 'E:/nguon/clip loi.mp4',
        reason: 'Không probe được video sau 2 lần: ffprobe timeout',
      },
    ])
  })
})
