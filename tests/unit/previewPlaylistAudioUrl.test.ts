import { describe, expect, it } from 'vitest'

function toPreviewAudioUrl(filePath: string): string {
  return `app://local-file/?path=${encodeURIComponent(filePath)}`
}

describe('Preview playlist audio URL', () => {
  it.each([
    'E:\\music\\set 01\\bài #1.mp3',
    '\\\\server\\share\\100% mix.mp3',
  ])('round-trips Windows path through app protocol query: %s', (filePath) => {
    const url = toPreviewAudioUrl(filePath)
    expect(url.startsWith('app://local-file/?path=')).toBe(true)
    expect(new URL(url).searchParams.get('path')).toBe(filePath)
    expect(url).not.toMatch(/^file:/)
  })
})
