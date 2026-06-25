import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

import { spawn } from 'child_process'
import { runPlaybackTest } from '../../../backend/video/playbackTest'

function makePlayerChild(
  event: 'close' | 'error',
  payload?: number | Error | null
) {
  const child = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn> }
  child.kill = vi.fn()

  setTimeout(() => {
    if (event === 'close') {
      child.emit('close', payload ?? 0)
      return
    }
    child.emit('error', payload instanceof Error ? payload : new Error('spawn failed'))
  }, 0)

  return child
}

describe('runPlaybackTest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves successfully when mpv closes with exit code 0', async () => {
    vi.mocked(spawn).mockReturnValue(makePlayerChild('close', 0) as any)

    await expect(runPlaybackTest('E:/output/video 1.mp4')).resolves.toEqual({
      player: 'mpv',
      success: true,
      exitCode: 0,
    })
  })

  it('falls back to vlc when mpv emits error', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(makePlayerChild('error') as any)
      .mockReturnValueOnce(makePlayerChild('close', 0) as any)

    await expect(runPlaybackTest('E:/output/video 1.mp4')).resolves.toEqual({
      player: 'vlc',
      success: true,
      exitCode: 0,
    })
  })
})
