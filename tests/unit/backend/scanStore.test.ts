import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { isScanResultUsable, scanConfigKey } from '../../../backend/music/scanStore'
import type { ScanMusicConfig, ScanMusicResult } from '../../../backend/music/scanMusic'

const tempDirs: string[] = []

const config: ScanMusicConfig = {
  version: 2,
  genres: [{
    id: 'genre-1',
    name: 'House',
    priorityFolders: ['E:/Music/House/Priority'],
    randomFolders: ['E:/Music/House/Random'],
    openingFolders: [],
  }],
}

describe('scanStore helpers', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true })))
  })

  it('uses stable config keys for same folders in different order', () => {
    const reordered: ScanMusicConfig = {
      version: 2,
      genres: [{
        id: 'genre-1',
        name: 'House',
        priorityFolders: ['E:/Music/House/Priority'],
        randomFolders: ['E:/Music/House/Random'],
      }],
    }

    expect(scanConfigKey(reordered)).toBe(scanConfigKey(config))
  })

  it('rejects cached results when a scanned path is missing', async () => {
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'scan-store-'))
    tempDirs.push(tempRoot)
    const existing = path.join(tempRoot, 'ok.m4a')
    await fsp.writeFile(existing, 'ok')

    const result: ScanMusicResult = {
      config,
      tracks: [{
        id: createHash('md5').update(existing).digest('hex'),
        path: existing,
        fileName: 'ok.m4a',
        folderType: 'priority',
        duration: 10,
        size: 2,
      }],
      summary: {
        priorityCount: 1,
        randomCount: 0,
        totalCount: 1,
        priorityDuration: 10,
        randomDuration: 0,
        totalDuration: 10,
      },
    }

    expect(isScanResultUsable(result, config)).toBe(true)
    result.tracks[0].path = path.join(tempRoot, 'missing.m4a')
    expect(isScanResultUsable(result, config)).toBe(false)
  })
})
