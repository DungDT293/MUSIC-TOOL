import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const handlers = new Map<string, (event: unknown, payload: unknown) => unknown>()
const listeners = new Map<string, (event: unknown, ...args: unknown[]) => void>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, payload: unknown) => unknown) => handlers.set(channel, fn),
    on: (channel: string, fn: (event: unknown, ...args: unknown[]) => void) => listeners.set(channel, fn),
  },
}))

vi.mock('../../electron/authState', () => ({ isValidAbsolutePath: () => true }))

vi.mock('../../backend/ffmpeg/config', () => ({
  getFfmpegPaths: () => ({ ffmpeg: FFMPEG, ffprobe: FFPROBE }),
}))

const ROOT = path.resolve(__dirname, '../..')
const FFMPEG = path.join(ROOT, 'bin', 'ffmpeg.exe')
const FFPROBE = path.join(ROOT, 'bin', 'ffprobe.exe')
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'songnhac-export-'))

const h264Path = path.join(workDir, 'clip.h264')
const audioPath = path.join(workDir, 'audio.m4a')
const outputPath = path.join(workDir, 'out.mp4')

function run(bin: string, args: string[]): void {
  const result = spawnSync(bin, args, { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${path.basename(bin)} failed: ${result.stderr?.slice(-400)}`)
}

beforeAll(() => {
  run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=1', '-c:v', 'libx264', '-preset', 'ultrafast', '-bsf:v', 'h264_mp4toannexb', '-f', 'h264', h264Path])
  run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'aac', audioPath])
})

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true })
})

describe('Song Nhạc frame export IPC', () => {
  it('writes chunks, muxes with audio and produces a playable MP4', async () => {
    const { registerSongNhacHandlers } = await import('../../electron/handlers/songNhacHandlers')
    const { SONG_NHAC_FRAMES_BEGIN, SONG_NHAC_FRAMES_CHUNK, SONG_NHAC_FRAMES_END, SONG_NHAC_FRAMES_FLUSH } = await import(
      '../../shared/songNhacChannels'
    )
    registerSongNhacHandlers(() => null)

    const begin = handlers.get(SONG_NHAC_FRAMES_BEGIN) as (event: unknown, payload: unknown) => Promise<{ success: boolean; error?: string }>
    const chunk = listeners.get(SONG_NHAC_FRAMES_CHUNK) as (event: unknown, requestId: unknown, data: unknown) => void
    const flush = handlers.get(SONG_NHAC_FRAMES_FLUSH) as (event: unknown, requestId: unknown) => Promise<unknown>
    const end = handlers.get(SONG_NHAC_FRAMES_END) as (event: unknown, requestId: unknown) => Promise<{ success: boolean; error?: string; outputPath?: string }>

    const requestId = 'test-export'
    const started = await begin(null, {
      requestId,
      audioPath,
      outputPath,
      width: 320,
      height: 180,
      fps: 30,
      totalFrames: 30,
      durationSec: 1,
    })
    if (!started.success) console.error("BEGIN ERROR:", started.error)
    expect(started.success).toBe(true)

    const stream = fs.readFileSync(h264Path)
    // Split into two chunks to exercise the append path.
    chunk(null, requestId, stream.subarray(0, Math.floor(stream.length / 2)))
    chunk(null, requestId, stream.subarray(Math.floor(stream.length / 2)))
    await flush(null, requestId)

    const finished = await end(null, requestId)
    expect(finished.success).toBe(true)
    expect(fs.existsSync(outputPath)).toBe(true)

    const probe = spawnSync(
      FFPROBE,
      ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height,color_space,color_transfer,color_primaries', '-of', 'json', outputPath],
      { encoding: 'utf8' },
    )
    const parsed = JSON.parse(probe.stdout) as { streams: Array<{ codec_name: string; width?: number; height?: number }>; format: { duration: string } }
    expect(parsed.streams.some((item) => item.codec_name === 'h264')).toBe(true)
    expect(parsed.streams.some((item) => item.codec_name === 'aac')).toBe(true)
    const video = parsed.streams.find((item) => item.codec_name === 'h264')
    expect(video?.color_space).toBe('bt709')
    expect(video?.color_primaries).toBe('bt709')
    expect(Number(parsed.format.duration)).toBeGreaterThan(0.8)
  }, 120000)

  it('rejects an unknown session id', async () => {
    const { SONG_NHAC_FRAMES_END } = await import('../../shared/songNhacChannels')
    const end = handlers.get(SONG_NHAC_FRAMES_END) as (event: unknown, requestId: unknown) => Promise<{ success: boolean; error?: string }>
    const result = await end(null, 'missing-session')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Không tìm thấy')
  })
})
