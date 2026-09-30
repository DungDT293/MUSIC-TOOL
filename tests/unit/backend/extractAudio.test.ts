import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())
const probeMock = vi.hoisted(() => vi.fn())
const pathsMock = vi.hoisted(() => vi.fn(() => ({ ffmpeg: 'ffmpeg.exe', ffprobe: 'ffprobe.exe' })))

vi.mock('node:child_process', () => ({ spawn: spawnMock }))
vi.mock('../../../backend/ffmpeg/config', () => ({ getFfmpegPaths: pathsMock }))
vi.mock('../../../backend/ffmpeg/probe', () => ({ probeFile: probeMock }))

import { extractAudioBatch } from '../../../backend/video/extractAudio'

const tempDirs: string[] = []
async function outputDir() {
  const dir = await mkdtemp(path.join(tmpdir(), 'extract-audio-'))
  tempDirs.push(dir)
  return dir
}

async function cleanup() {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
}

function child(exitCode = 0, output = true, onBeforeClose?: () => Promise<void>) {
  const proc = new EventEmitter() as any
  proc.stderr = new EventEmitter()
  proc.kill = vi.fn()
  queueMicrotask(async () => {
    if (output) proc.stderr.emit('data', Buffer.from('time=00:00:01.00'))
    await onBeforeClose?.()
    proc.emit('close', exitCode)
  })
  return proc
}

function completeChild(exitCode = 0, output = true, onBeforeClose?: () => Promise<void>) {
  const proc = child(exitCode, output, onBeforeClose)
  Object.defineProperty(proc, 'exitCode', { value: null, writable: true })
  Object.defineProperty(proc, 'signalCode', { value: null, writable: true })
  return proc
}

afterEach(async () => { vi.clearAllMocks(); await cleanup() })

describe('extractAudioBatch', () => {
  it('uses audio-only MP3 args and publishes output', async () => {
    probeMock.mockResolvedValue({ format: { duration: 1 }, audio: { codec: 'aac' } })
    const dir = await outputDir()
    spawnMock.mockImplementation((_command: string, args: string[]) => completeChild(0, true, async () => {
      await writeFile(args.at(-1), 'audio')
    }))
    const result = await extractAudioBatch({ inputFiles: ['C:\\input.mp4'], outputDir: dir, audioFormat: 'mp3', requestId: '../../../../escape' })

    const args = spawnMock.mock.calls[0][1] as string[]
    expect(args).toContain('-map')
    expect(args).toContain('0:a:0')
    expect(args).toContain('-vn')
    expect(args).toContain('libmp3lame')
    expect(result.processed).toBe(1)
    expect(result.outputPaths).toHaveLength(1)
  })

  it('uses PCM WAV args and continues after per-file failure', async () => {
    probeMock.mockResolvedValue({ format: { duration: 1 }, audio: { codec: 'aac' } })
    const dir = await outputDir()
    spawnMock.mockImplementationOnce(() => child(1, false)).mockImplementationOnce((_command: string, args: string[]) => completeChild(0, true, async () => {
      await writeFile(args.at(-1), 'audio')
    }))
    const result = await extractAudioBatch({ inputFiles: ['C:\\one.mp4', 'C:\\two.mp4'], outputDir: dir, audioFormat: 'wav', requestId: 'extract-test-2' })
    const args = spawnMock.mock.calls[1][1] as string[]
    expect(args).toContain('pcm_s16le')
    expect(result.processed).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.failures[0]?.fileName).toBe('one.mp4')
    expect(result.failures[0]?.error).toContain('FFmpeg')
  })
})
