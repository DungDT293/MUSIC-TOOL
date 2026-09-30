import { describe, expect, it } from 'vitest'
import { createQueueVideoRequest } from '../../src/pages/Video/queueDownloadRequest'

describe('createQueueVideoRequest', () => {
  it('keeps queue audio settings local to every request', () => {
    const options = {
      outputDir: 'C:\\downloads',
      quality: '1080' as const,
      downloadSubtitles: false,
      downloadThumbnail: false,
      audioOnly: true,
      audioFormat: 'wav' as const,
    }

    const first = createQueueVideoRequest('https://www.tiktok.com/@creator/video/1', options)
    const second = createQueueVideoRequest('https://www.tiktok.com/@creator/video/2', options)
    first.audioFormat = 'mp3'

    expect(first.url).toContain('/1')
    expect(second.url).toContain('/2')
    expect(second.audioOnly).toBe(true)
    expect(second.audioFormat).toBe('wav')
  })

  it('supports video mode without inheriting single-download audio state', () => {
    const request = createQueueVideoRequest('https://www.tiktok.com/@creator/video/3', {
      outputDir: 'C:\\downloads',
      quality: '1080',
      downloadSubtitles: false,
      downloadThumbnail: false,
      audioOnly: false,
      audioFormat: 'mp3',
    })
    expect(request.audioOnly).toBe(false)
  })
})
