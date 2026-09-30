import { describe, expect, it } from 'vitest'

// Regression coverage keeps diagnostics pure and deterministic; FFmpeg process integration stays mocked by the media harness.
import {
  canStreamCopyAac,
  describeAudioExportError,
  extractMissingAudioPaths,
  isMissingAudioFailure,
  describeCorruptAudioTracks,
  isAudioDecodeFailure,
} from '../../../backend/music/exportAudio'

describe('exportAudio codec recovery', () => {
  it('stream-copies only actual AAC codecs', () => {
    expect(canStreamCopyAac(['aac', 'AAC'])).toBe(true)
    expect(canStreamCopyAac(['aac', 'opus'])).toBe(false)
    expect(canStreamCopyAac(['opus'])).toBe(false)
    expect(canStreamCopyAac([])).toBe(false)
  })

  it('explains Opus-in-M4A container errors in Vietnamese', () => {
    const message = describeAudioExportError(
      'Could not find tag for codec opus in stream #0, codec not currently supported in container',
    )

    expect(message).toContain('Nguyên nhân: Có file .m4a chứa codec Opus')
    expect(message).toContain('Cách xử lý: App sẽ tự mã hóa lại playlist sang AAC')
    expect(message).toContain('Quét nhạc → Chuẩn hóa audio')
  })

  it('extracts missing audio input paths for recovery', () => {
    const message = 'Error opening input file \\\\server\\music\\missing.m4a.\nError opening input files: No such file or directory'
    expect(extractMissingAudioPaths(message)).toEqual(['\\\\server\\music\\missing.m4a.'])
    expect(isMissingAudioFailure(message)).toBe(true)
  })

  it('identifies decoder corruption and names bad tracks', () => {
    const message = describeCorruptAudioTracks(['bad Opus.m4a'], 'Invalid data found when processing input')
    expect(message).toContain('bad Opus.m4a')
    expect(message).toContain('Chuẩn hóa audio')
  })

  it('classifies decoder corruption', () => {
    expect(isAudioDecodeFailure(new Error('Number of scalefactor bands exceeds limit'))).toBe(true)
    expect(isAudioDecodeFailure(new Error('Permission denied'))).toBe(false)
  })

  it('keeps unknown FFmpeg errors actionable', () => {
    const message = describeAudioExportError('Unexpected encoder failure')

    expect(message).toContain('Nguyên nhân: FFmpeg không thể xuất playlist')
    expect(message).toContain('Cách xử lý: Quét nhạc lại')
    expect(message).toContain('Chi tiết kỹ thuật: Unexpected encoder failure')
  })
})
