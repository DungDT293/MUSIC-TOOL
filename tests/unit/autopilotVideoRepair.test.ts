import { describe, expect, it } from 'vitest'
import {
  extractAutopilotVideoFailurePaths,
  getVideoRepairOutputDir,
  groupVideoRepairPathsByRoot,
} from '../../src/utils/autopilotVideoRepair'

describe('autopilotVideoRepair', () => {
  it('extracts exact failed video paths from Autopilot diagnostic', () => {
    const paths = extractAutopilotVideoFailurePaths([
      'Video lỗi:',
      '1. Z:\\videos\\source\\part_001.mp4',
      '   Lỗi: Video không có duration hợp lệ.',
      '2. Z:\\videos\\source\\part_002.mp4',
    ].join('\n'))

    expect(paths).toEqual([
      'Z:\\videos\\source\\part_001.mp4',
      'Z:\\videos\\source\\part_002.mp4',
    ])
  })

  it('groups only paths inside configured roots', () => {
    const groups = groupVideoRepairPathsByRoot(
      ['Z:\\videos\\source\\part_001.mp4', 'C:\\outside\\part_002.mp4'],
      ['Z:\\videos\\source'],
    )

    expect(groups).toEqual([{
      root: 'Z:\\videos\\source',
      paths: ['Z:\\videos\\source\\part_001.mp4'],
    }])
  })

  it('always normalizes into a separate sibling folder', () => {
    expect(getVideoRepairOutputDir('Z:\\videos\\source')).toBe('Z:\\videos\\source_autopilot_normalized')
  })

  it('ignores numbered prose lines that are not absolute paths', () => {
    expect(extractAutopilotVideoFailurePaths('1. lỗi duration\n2. kiểm tra file')).toEqual([])
  })
})
