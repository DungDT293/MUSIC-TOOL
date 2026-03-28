/**
 * tests/unit/backend/outputVerification.test.ts
 * Unit tests cho verifyOutputVideo — duration check, decodeOk logic
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock child_process spawn — MUST match the import style in outputVerification.ts
// outputVerification.ts uses: import { spawn } from 'child_process' (no node: prefix)
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

// Mock probeFile
vi.mock('../../../backend/ffmpeg/probe', () => ({
  probeFile: vi.fn(),
}))

// Mock getFfmpegPaths
vi.mock('../../../backend/ffmpeg/config', () => ({
  getFfmpegPaths: vi.fn(() => ({ ffmpeg: '/usr/bin/ffmpeg', ffprobe: '/usr/bin/ffprobe' })),
}))

import { spawn } from 'child_process'
import { probeFile } from '../../../backend/ffmpeg/probe'
import { verifyOutputVideo } from '../../../backend/video/outputVerification'
import { EventEmitter } from 'node:events'

// Helper to create a fake spawn child process
function makeFakeChild(exitCode: number, stderrOutput: string) {
  const child = new EventEmitter() as any
  child.stderr = new EventEmitter()
  child.stdin = { write: vi.fn(), end: vi.fn(), destroyed: false }

  // Emit stderr data and close asynchronously
  setTimeout(() => {
    if (stderrOutput) child.stderr.emit('data', Buffer.from(stderrOutput))
    child.emit('close', exitCode)
  }, 10)

  return child
}

describe('verifyOutputVideo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── Duration checks ──────────────────────────────────────────────────────

  it('returns correct durationSec from probe', async () => {
    vi.mocked(probeFile).mockResolvedValue({
      format: { duration: 120.5 },
      video: { codec_name: 'h264', avg_frame_rate: '30/1' },
      audio: { codec: 'aac' },
    } as any)
    vi.mocked(spawn).mockReturnValue(makeFakeChild(0, '') as any)

    const result = await verifyOutputVideo('/tmp/out.mp4')
    expect(result.durationSec).toBeCloseTo(120.5)
    expect(result.videoCodec).toBe('h264')
    expect(result.audioCodec).toBe('aac')
    expect(result.fps).toBeCloseTo(30)
  })

  it('no duration warning when diff within tolerance', async () => {
    vi.mocked(probeFile).mockResolvedValue({
      format: { duration: 100 },
      video: null,
      audio: null,
    } as any)
    vi.mocked(spawn).mockReturnValue(makeFakeChild(0, '') as any)

    const result = await verifyOutputVideo('/tmp/out.mp4', {
      expectedDurationSec: 102,
      toleranceSec: 5,
    })
    expect(result.durationWarning).toBe(false)
    expect(result.durationDiffSec).toBeCloseTo(2)
  })

  it('sets durationWarning when diff exceeds tolerance', async () => {
    vi.mocked(probeFile).mockResolvedValue({
      format: { duration: 100 },
      video: null,
      audio: null,
    } as any)
    vi.mocked(spawn).mockReturnValue(makeFakeChild(0, '') as any)

    const result = await verifyOutputVideo('/tmp/out.mp4', {
      expectedDurationSec: 115,
      toleranceSec: 5,
    })
    expect(result.durationWarning).toBe(true)
    expect(result.durationDiffSec).toBeCloseTo(15)
  })

  // ─── decodeOk — the key fix from audit ───────────────────────────────────

  it('decodeOk=true when exit code 0 and no error keywords in stderr', async () => {
    vi.mocked(probeFile).mockResolvedValue({ format: { duration: 10 }, video: null, audio: null } as any)
    // FFmpeg always writes info to stderr even on success — should NOT fail
    vi.mocked(spawn).mockReturnValue(makeFakeChild(0, 'frame=  300 fps=30 size=   1024kB time=00:00:10.00') as any)

    const result = await verifyOutputVideo('/tmp/out.mp4')
    expect(result.decodeOk).toBe(true)
  })

  it('decodeOk=false when exit code is non-zero', async () => {
    vi.mocked(probeFile).mockResolvedValue({ format: { duration: 10 }, video: null, audio: null } as any)
    vi.mocked(spawn).mockReturnValue(makeFakeChild(1, 'some warning') as any)

    const result = await verifyOutputVideo('/tmp/out.mp4')
    expect(result.decodeOk).toBe(false)
  })

  it('decodeOk=false when stderr contains "Error" keyword even with code 0', async () => {
    vi.mocked(probeFile).mockResolvedValue({ format: { duration: 10 }, video: null, audio: null } as any)
    vi.mocked(spawn).mockReturnValue(makeFakeChild(0, 'Error while decoding stream #0:0') as any)

    const result = await verifyOutputVideo('/tmp/out.mp4')
    expect(result.decodeOk).toBe(false)
  })

  it('decodeOk=false when stderr contains "corrupt"', async () => {
    vi.mocked(probeFile).mockResolvedValue({ format: { duration: 10 }, video: null, audio: null } as any)
    vi.mocked(spawn).mockReturnValue(makeFakeChild(0, 'corrupt frame detected') as any)

    const result = await verifyOutputVideo('/tmp/out.mp4')
    expect(result.decodeOk).toBe(false)
  })

  it('decodeOk=false when stderr contains "moov atom not found"', async () => {
    vi.mocked(probeFile).mockResolvedValue({ format: { duration: 10 }, video: null, audio: null } as any)
    vi.mocked(spawn).mockReturnValue(makeFakeChild(1, 'moov atom not found') as any)

    const result = await verifyOutputVideo('/tmp/out.mp4')
    expect(result.decodeOk).toBe(false)
  })

  it('decodeOk=false when spawn throws', async () => {
    vi.mocked(probeFile).mockResolvedValue({ format: { duration: 10 }, video: null, audio: null } as any)
    vi.mocked(spawn).mockImplementation(() => { throw new Error('spawn ENOENT') })

    const result = await verifyOutputVideo('/tmp/out.mp4')
    expect(result.decodeOk).toBe(false)
  })

  // ─── FPS parsing ──────────────────────────────────────────────────────────

  it('parses fractional fps correctly (24000/1001 = ~23.976)', async () => {
    vi.mocked(probeFile).mockResolvedValue({
      format: { duration: 10 },
      video: { avg_frame_rate: '24000/1001' },
      audio: null,
    } as any)
    vi.mocked(spawn).mockReturnValue(makeFakeChild(0, '') as any)

    const result = await verifyOutputVideo('/tmp/out.mp4')
    expect(result.fps).toBeCloseTo(23.976, 2)
  })

  it('returns null fps for 0/0', async () => {
    vi.mocked(probeFile).mockResolvedValue({
      format: { duration: 10 },
      video: { avg_frame_rate: '0/0' },
      audio: null,
    } as any)
    vi.mocked(spawn).mockReturnValue(makeFakeChild(0, '') as any)

    const result = await verifyOutputVideo('/tmp/out.mp4')
    expect(result.fps).toBeNull()
  })
})
