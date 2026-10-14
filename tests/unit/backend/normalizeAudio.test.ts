import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeAudio } from '../../../backend/music/normalizeAudio'

// Mock probeFile and spawn
vi.mock('../../../backend/ffmpeg/probe', () => ({
  probeFile: vi.fn(),
}))

vi.mock('../../../backend/ffmpeg/config', () => ({
  getFfmpegPaths: () => ({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }),
}))

const mockSpawn = vi.fn()
vi.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}))

import { probeFile } from '../../../backend/ffmpeg/probe'

describe('normalizeAudio backend extensions', () => {
  const tempDirs: string[] = []

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })),
    )
  })

  it('supports perSourceFolderSuffix and deleteOriginalOnSuccess', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'norm-test-'))
    tempDirs.push(root)

    const folder1 = path.join(root, 'techno')
    await fsp.mkdir(folder1, { recursive: true })

    const inputWav = path.join(folder1, 'track1.wav')
    await fsp.writeFile(inputWav, 'dummy wav content')

    vi.mocked(probeFile).mockResolvedValue({
      streams: [{ codec_type: 'audio', codec_name: 'pcm_s16le' }],
      audio: { codec: 'pcm_s16le' },
      format: { duration: 10, size: 1024 },
    } as any)

    // Simulate FFmpeg writing an output file upon invocation
    mockSpawn.mockImplementation((_cmd, args) => {
      const outPath = args[args.length - 1]
      fs.writeFileSync(outPath, 'fake m4a aac output')
      return {
        on: (event: string, cb: any) => {
          if (event === 'close') setTimeout(() => cb(0), 10)
        },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
      }
    })

    const result = await normalizeAudio({
      files: [inputWav],
      targetBitrate: 384,
      outputFormat: 'aac',
      perSourceFolderSuffix: '_chuanhoa',
      deleteOriginalOnSuccess: true,
    })

    expect(result.success).toBe(true)
    expect(result.processed).toBe(1)
    expect(result.failed).toBe(0)

    const expectedOutputDir = path.join(root, 'techno_chuanhoa')
    const expectedOutputFile = path.join(expectedOutputDir, 'track1.m4a')

    expect(result.outputFiles[0]).toBe(expectedOutputFile)
    expect(fs.existsSync(expectedOutputFile)).toBe(true)

    // Verify original file was deleted because deleteOriginalOnSuccess=true
    expect(fs.existsSync(inputWav)).toBe(false)
    expect(result.deletedOriginalFiles).toEqual([inputWav])
  })

  it('keeps original file when deleteOriginalOnSuccess is false or omitted', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'norm-keep-'))
    tempDirs.push(root)

    const folder1 = path.join(root, 'lofi')
    await fsp.mkdir(folder1, { recursive: true })

    const inputMp3 = path.join(folder1, 'chill.mp3')
    await fsp.writeFile(inputMp3, 'dummy mp3 content')

    vi.mocked(probeFile).mockResolvedValue({
      streams: [{ codec_type: 'audio', codec_name: 'mp3' }],
      audio: { codec: 'mp3' },
      format: { duration: 20, size: 2048 },
    } as any)

    mockSpawn.mockImplementation((_cmd, args) => {
      const outPath = args[args.length - 1]
      fs.writeFileSync(outPath, 'fake m4a aac output')
      return {
        on: (event: string, cb: any) => {
          if (event === 'close') setTimeout(() => cb(0), 10)
        },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
      }
    })

    const result = await normalizeAudio({
      files: [inputMp3],
      targetBitrate: 320,
      outputFormat: 'aac',
      perSourceFolderSuffix: '_chuanhoa',
      deleteOriginalOnSuccess: false,
    })

    expect(result.success).toBe(true)
    expect(result.processed).toBe(1)

    // Original file remains
    expect(fs.existsSync(inputMp3)).toBe(true)
    expect(result.deletedOriginalFiles).toEqual([])
  })
})

