import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../backend/ffmpeg/probe', () => ({
  probeFile: vi.fn(),
}))

vi.mock('../../../backend/music/scanStore', () => ({
  saveScanResult: vi.fn(),
}))

import { probeFile } from '../../../backend/ffmpeg/probe'
import { scanMusicFolders } from '../../../backend/music/scanMusic'

const tempDirs: string[] = []

describe('scanMusicFolders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) =>
        fsp.rm(dir, { recursive: true, force: true }),
      ),
    )
  })

  it('scans nested audio files and reports summary counts', async () => {
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'scan-music-'))
    tempDirs.push(tempRoot)

    const priorityDir = path.join(tempRoot, 'priority')
    const nestedDir = path.join(priorityDir, 'nested')
    await fsp.mkdir(nestedDir, { recursive: true })
    await Promise.all([
      fsp.writeFile(path.join(priorityDir, 'a.mp3'), 'a'),
      fsp.writeFile(path.join(nestedDir, 'b.m4a'), 'b'),
    ])

    vi.mocked(probeFile).mockResolvedValue({
      format: { duration: 12, size: 1024, bit_rate: 192000 },
      audio: { codec: 'aac' },
    } as any)

    const progressEvents: string[] = []
    const result = await scanMusicFolders(
      {
        priorityFolder: priorityDir,
        randomFolder: null,
      },
      {
        onProgress: (progress) => {
          progressEvents.push(progress.phase)
        },
      },
    )

    expect(result.tracks).toHaveLength(2)
    expect(result.summary.priorityCount).toBe(2)
    expect(result.summary.randomCount).toBe(0)
    expect(result.summary.totalCount).toBe(2)
    expect(progressEvents).toContain('discover')
    expect(progressEvents).toContain('probe')
    expect(vi.mocked(probeFile)).toHaveBeenCalledTimes(2)
  })

  it('aborts promptly when the caller cancels the scan', async () => {
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'scan-music-abort-'))
    tempDirs.push(tempRoot)

    const priorityDir = path.join(tempRoot, 'priority')
    const nestedDir = path.join(priorityDir, 'nested')
    await fsp.mkdir(nestedDir, { recursive: true })
    await Promise.all([
      fsp.writeFile(path.join(priorityDir, 'a.mp3'), 'a'),
      fsp.writeFile(path.join(nestedDir, 'b.mp3'), 'b'),
    ])

    vi.mocked(probeFile).mockResolvedValue({
      format: { duration: 12, size: 1024, bit_rate: 192000 },
      audio: { codec: 'aac' },
    } as any)

    const controller = new AbortController()
    const scanPromise = scanMusicFolders(
      {
        priorityFolder: priorityDir,
        randomFolder: null,
      },
      {
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.phase === 'discover') {
            controller.abort()
          }
        },
      },
    )

    await expect(scanPromise).rejects.toMatchObject({ code: 'ABORT_ERR' })
    expect(vi.mocked(probeFile)).not.toHaveBeenCalled()
  })
})
