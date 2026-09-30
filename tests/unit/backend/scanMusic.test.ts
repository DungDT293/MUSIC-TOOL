import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../backend/ffmpeg/probe', () => ({
  probeFile: vi.fn(),
}))

import { probeFile } from '../../../backend/ffmpeg/probe'
import { __scanMusicTestUtils, scanMusicFolders } from '../../../backend/music/scanMusic'

const tempDirs: string[] = []

describe('scanMusicFolders', () => {
  it('normalizes legacy folders into one scan genre', () => {
    const config = __scanMusicTestUtils.normalizeScanPayload({
      priorityFolder: 'E:/music/priority',
      randomFolder: 'E:/music/random',
    })

    expect(config.genres).toEqual([
      {
        id: 'default',
        name: 'Mặc định',
        priorityFolders: ['E:/music/priority'],
        randomFolders: ['E:/music/random'],
        openingFolders: [],
      },
    ])
  })

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

  it('scans opening folders with their genre metadata', async () => {
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'scan-music-opening-'))
    tempDirs.push(tempRoot)
    const openingDir = path.join(tempRoot, 'opening')
    const priorityDir = path.join(tempRoot, 'priority')
    await fsp.mkdir(openingDir)
    await fsp.mkdir(priorityDir)
    await fsp.writeFile(path.join(openingDir, 'intro.m4a'), 'intro')
    await fsp.writeFile(path.join(priorityDir, 'body.m4a'), 'body')
    vi.mocked(probeFile).mockResolvedValue({ format: { duration: 12, size: 1024, bit_rate: 192000 }, audio: { codec: 'aac' } } as any)

    const result = await scanMusicFolders({
      genres: [{ id: 'house', name: 'House', priorityFolders: [priorityDir], randomFolders: [], openingFolders: [openingDir] }],
      forceRescan: true,
      persist: false,
    })

    expect(result.tracks.find((track) => track.folderType === 'opening')).toMatchObject({ fileName: 'intro.m4a', genreId: 'house', genreName: 'House', sourceFolder: openingDir })
    expect(result.summary).toMatchObject({ openingCount: 1, priorityCount: 1, totalCount: 2 })
  })

  it('assigns stable IDs from canonical paths and deduplicates overlapping roots', async () => {
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'scan-music-alias-'))
    tempDirs.push(tempRoot)

    const priorityDir = path.join(tempRoot, 'priority')
    const randomDir = path.join(tempRoot, 'random')
    await fsp.mkdir(priorityDir, { recursive: true })
    await fsp.mkdir(randomDir, { recursive: true })
    await fsp.writeFile(path.join(priorityDir, 'same.mp3'), 'same')
    await fsp.writeFile(path.join(randomDir, 'other.mp3'), 'other')

    vi.mocked(probeFile).mockResolvedValue({
      format: { duration: 12, size: 1024, bit_rate: 192000 },
      audio: { codec: 'aac' },
    } as any)

    const first = await scanMusicFolders({
      priorityFolder: priorityDir,
      randomFolder: priorityDir,
      forceRescan: true,
      persist: false,
    })
    const second = await scanMusicFolders({
      priorityFolder: priorityDir,
      randomFolder: priorityDir,
      forceRescan: true,
      persist: false,
    })

    expect(first.tracks).toHaveLength(1)
    expect(first.tracks[0]?.folderType).toBe('priority')
    expect(first.tracks[0]?.id).toBe(second.tracks[0]?.id)
    expect(first.tracks[0]?.id).toBe(createHash('md5').update(await fsp.realpath(path.join(priorityDir, 'same.mp3'))).digest('hex'))
  })

  it('keeps distinct canonical files as distinct tracks', async () => {
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'scan-music-distinct-'))
    tempDirs.push(tempRoot)
    await fsp.writeFile(path.join(tempRoot, 'a.mp3'), 'a')
    await fsp.writeFile(path.join(tempRoot, 'b.mp3'), 'b')

    vi.mocked(probeFile).mockResolvedValue({
      format: { duration: 12, size: 1024, bit_rate: 192000 },
      audio: { codec: 'aac' },
    } as any)

    const result = await scanMusicFolders({ priorityFolder: tempRoot, randomFolder: null, forceRescan: true, persist: false })
    expect(result.tracks).toHaveLength(2)
    expect(new Set(result.tracks.map((track) => track.id)).size).toBe(2)
  })

  it('reports Opus codec inside m4a as non-AAC', async () => {
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'scan-music-opus-'))
    tempDirs.push(tempRoot)
    await fsp.writeFile(path.join(tempRoot, 'opus.m4a'), 'opus')

    vi.mocked(probeFile).mockResolvedValue({
      format: { duration: 12, size: 1024, bit_rate: 123000 },
      audio: { codec: 'opus' },
    } as any)

    const result = await scanMusicFolders({
      priorityFolder: tempRoot,
      randomFolder: null,
      forceRescan: true,
      persist: false,
    })

    expect(result.tracks[0]?.codec).toBe('opus')
    expect(result.nonAacFiles).toEqual([path.join(tempRoot, 'opus.m4a')])
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
        forceRescan: true,
        persist: false,
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
        forceRescan: true,
        persist: false,
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
