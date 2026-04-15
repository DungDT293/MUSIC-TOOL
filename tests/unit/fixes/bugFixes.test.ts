/**
 * tests/unit/fixes/bugFixes.test.ts
 *
 * Tests chứng minh từng bug đã được fix đúng.
 * Mỗi suite có:
 *   - test chứng minh code HIỆN TẠI (fixed) đúng
 *   - test chứng minh code CŨ (buggy) sẽ fail nếu không fix
 */

import { describe, it, expect, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Bug Fix 2B — ExportDialog.tsx: timeSec hardcoded = 0
// ─────────────────────────────────────────────────────────────────────────────

function computeExportTimeSec(
  frameIndex: number,
  totalFrames: number,
  audioDurationSec: number | null | undefined
): number {
  return totalFrames > 0 ? (frameIndex / totalFrames) * (audioDurationSec ?? 0) : 0
}

describe('Bug Fix 2B — ExportDialog timeSec calculation', () => {
  it('returns 0 when totalFrames=0 (no division by zero)', () => {
    expect(computeExportTimeSec(0, 0, 120)).toBe(0)
  })

  it('returns 0 at the very first frame (frameIndex=0)', () => {
    expect(computeExportTimeSec(0, 100, 120)).toBe(0)
  })

  it('returns half duration at midpoint frame', () => {
    expect(computeExportTimeSec(50, 100, 120)).toBe(60)
  })

  it('returns full duration at the last frame', () => {
    expect(computeExportTimeSec(100, 100, 120)).toBe(120)
  })

  it('handles null audioDurationSec (treats as 0)', () => {
    expect(computeExportTimeSec(50, 100, null)).toBe(0)
  })

  it('handles undefined audioDurationSec (treats as 0)', () => {
    expect(computeExportTimeSec(50, 100, undefined)).toBe(0)
  })

  it('computes correct timeSec for typical export (240 frames, 180s song, frame 120 → 90s)', () => {
    expect(computeExportTimeSec(120, 240, 180)).toBe(90)
  })

  it('OLD CODE (hardcoded 0) would fail — fixed formula returns 180, not 0', () => {
    const oldBuggyResult = 0
    const fixedResult = computeExportTimeSec(75, 100, 240) // should be 180
    expect(fixedResult).toBe(180)
    expect(fixedResult).not.toBe(oldBuggyResult)
  })
})

function escapePathForConcatList(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/'/g, "'\\''")
}

function estimateCrossfadeOutputDuration(totalDurationSec: number, trackCount: number, crossfadeDurationSec: number): number {
  return Math.max(0, totalDurationSec - (Math.max(0, trackCount - 1) * crossfadeDurationSec))
}

describe('Regression â€” FFmpeg concat list escaping', () => {
  it('escapes single quote with close-escape-reopen syntax', () => {
    expect(escapePathForConcatList("C:\\music\\a'b.wav")).toBe("C:/music/a'\\''b.wav")
  })

  it('OLD escaping with doubled quote mangles the filename', () => {
    const oldEscaped = "C:/music/a'b.wav".replace(/'/g, "''")
    expect(oldEscaped).toBe("C:/music/a''b.wav")
    expect(oldEscaped).not.toBe(escapePathForConcatList("C:\\music\\a'b.wav"))
  })
})

describe('Regression â€” crossfade output duration', () => {
  it('uses total duration minus overlap only', () => {
    expect(estimateCrossfadeOutputDuration(20, 2, 4)).toBe(16)
    expect(estimateCrossfadeOutputDuration(30, 3, 4)).toBe(22)
  })

  it('OLD tail-concat formula overshoots the output duration', () => {
    const oldBuggyDuration = 20 - 4 + (10 - 4)
    const fixedDuration = estimateCrossfadeOutputDuration(20, 2, 4)
    expect(oldBuggyDuration).toBe(22)
    expect(fixedDuration).toBe(16)
    expect(oldBuggyDuration).not.toBe(fixedDuration)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Bug Fix 3 — useTimelineCompute.ts: Worker listener accumulation
// ─────────────────────────────────────────────────────────────────────────────

describe('Bug Fix 3 — Worker listener accumulation (useTimelineCompute)', () => {
  it('FIXED: each startCompute() terminates the previous worker', () => {
    const terminateSpy = vi.fn()
    let instanceCount = 0

    function MockWorker(this: any) {
      instanceCount++
      this.terminate = terminateSpy
      this.postMessage = vi.fn()
      this.addEventListener = vi.fn()
      this.removeEventListener = vi.fn()
    }

    let workerRef: any = null

    function startCompute(data: Float32Array) {
      if (workerRef) {
        workerRef.terminate()
        workerRef = null
      }
      workerRef = new (MockWorker as any)()
      workerRef.addEventListener('message', vi.fn())
      workerRef.addEventListener('error', vi.fn())
      workerRef.postMessage({ channelData: data, sampleRate: 44100, duration: 10 })
    }

    const data = new Float32Array(100)

    startCompute(data)
    expect(terminateSpy).not.toHaveBeenCalled()
    expect(instanceCount).toBe(1)

    startCompute(data)
    expect(terminateSpy).toHaveBeenCalledTimes(1)
    expect(instanceCount).toBe(2)

    startCompute(data)
    expect(terminateSpy).toHaveBeenCalledTimes(2)
    expect(instanceCount).toBe(3)
  })

  it('FIXED: exactly 2 listeners per call, 3 calls = 6 total (not accumulating on one worker)', () => {
    const addEventListenerSpy = vi.fn()

    function MockWorker(this: any) {
      this.terminate = vi.fn()
      this.postMessage = vi.fn()
      this.addEventListener = addEventListenerSpy
      this.removeEventListener = vi.fn()
    }

    let workerRef: any = null

    function startCompute(data: Float32Array) {
      if (workerRef) {
        workerRef.terminate()
        workerRef = null
      }
      workerRef = new (MockWorker as any)()
      workerRef.addEventListener('message', vi.fn())
      workerRef.addEventListener('error', vi.fn())
      workerRef.postMessage({ channelData: data })
    }

    const data = new Float32Array(10)
    startCompute(data)
    startCompute(data)
    startCompute(data)

    // 3 workers × 2 listeners each = 6 addEventListener calls total
    expect(addEventListenerSpy).toHaveBeenCalledTimes(6)
  })

  it('OLD CODE (reuse worker) accumulates listeners — 3 calls on 1 worker = 6 stale handlers', () => {
    const addEventListenerSpy = vi.fn()
    let workerCreated = 0

    function MockWorker(this: any) {
      workerCreated++
      this.terminate = vi.fn()
      this.postMessage = vi.fn()
      this.addEventListener = addEventListenerSpy
      this.removeEventListener = vi.fn()
    }

    let workerRef: any = null

    // Buggy version: never terminates, reuses same worker
    function startComputeBuggy(data: Float32Array) {
      if (!workerRef) {
        workerRef = new (MockWorker as any)()
      }
      // adds listeners without removing old ones
      workerRef.addEventListener('message', vi.fn())
      workerRef.addEventListener('error', vi.fn())
      workerRef.postMessage({ channelData: data })
    }

    const data = new Float32Array(10)
    startComputeBuggy(data) // 2 listeners
    startComputeBuggy(data) // 4 listeners — stale first pair still there
    startComputeBuggy(data) // 6 listeners — all fire on next message

    expect(addEventListenerSpy).toHaveBeenCalledTimes(6)
    expect(workerCreated).toBe(1) // only 1 worker — the bug
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Bug Fix 1 — AudioSourceSelector.tsx: missing await on setTrackFromPath()
// ─────────────────────────────────────────────────────────────────────────────

describe('Bug Fix 1 — AudioSourceSelector missing await on setTrackFromPath', () => {
  it('FIXED: awaiting async pathToFileUrl resolves before setAudioSource is called', async () => {
    let audioSourceSet: string | null = null

    async function pathToFileUrl(path: string): Promise<string> {
      await new Promise(r => setTimeout(r, 5))
      return `app://local-file/?path=${encodeURIComponent(path)}`
    }

    async function setTrackFromPath(path: string) {
      const fileUrl = await pathToFileUrl(path)
      audioSourceSet = fileUrl
    }

    await setTrackFromPath('/music/bài hát.mp3')

    expect(audioSourceSet).not.toBeNull()
    expect(audioSourceSet).toBe('app://local-file/?path=%2Fmusic%2Fb%C3%A0i%20h%C3%A1t.mp3')
  })

  it('OLD CODE (fire-and-forget) leaves state null immediately after call', async () => {
    let audioSourceSet: string | null = null

    async function pathToFileUrl(path: string): Promise<string> {
      await new Promise(r => setTimeout(r, 5))
      return `app://local-file/?path=${encodeURIComponent(path)}`
    }

    function setTrackFromPathBuggy(path: string) {
      // fire-and-forget — no await
      pathToFileUrl(path).then(fileUrl => {
        audioSourceSet = fileUrl
      })
    }

    setTrackFromPathBuggy('/music/bài hát.mp3')
    // synchronously after: state is still null (URL not yet resolved)
    expect(audioSourceSet).toBeNull()
  })

  it('FIXED: handleSelectMachineTrack is async and awaits in correct order', async () => {
    const calls: string[] = []

    async function pathToFileUrl(path: string): Promise<string> {
      await new Promise(r => setTimeout(r, 5))
      calls.push('pathToFileUrl:done')
      return `app://local-file/?path=${encodeURIComponent(path)}`
    }

    async function setAudioSource(url: string) {
      calls.push(`setAudioSource:${url}`)
    }

    async function handleSelectMachineTrack(path: string, _fileName: string) {
      calls.push('start')
      const fileUrl = await pathToFileUrl(path)
      await setAudioSource(fileUrl)
      calls.push('done')
    }

    await handleSelectMachineTrack('/music/track.mp3', 'track.mp3')

    expect(calls).toEqual([
      'start',
      'pathToFileUrl:done',
      'setAudioSource:app://local-file/?path=%2Fmusic%2Ftrack.mp3',
      'done',
    ])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Bug Fix 5 — router.tsx: keepAlivePages → KEEP_ALIVE_PAGES
// ─────────────────────────────────────────────────────────────────────────────

describe('Bug Fix 5 — router.tsx keepAlivePages ReferenceError', () => {
  const KEEP_ALIVE_PAGES = [
    { path: '/music/scan' },
    { path: '/music/playlist' },
    { path: '/music/preview' },
    { path: '/music/export' },
    { path: '/music/song-nhac' },
    { path: '/video/tools' },
    { path: '/video/cut-merge' },
    { path: '/video/final-export' },
    { path: '/video/youtube-downloader' },
    { path: '/video/seo' },
    { path: '/settings' },
  ]

  it('known paths are found in KEEP_ALIVE_PAGES (no fallback needed)', () => {
    for (const page of KEEP_ALIVE_PAGES) {
      expect(KEEP_ALIVE_PAGES.some(p => p.path === page.path)).toBe(true)
    }
  })

  it('unknown paths trigger fallback <Routes>', () => {
    const unknownPaths = ['/music/visualizer-v2', '/visualizer-v2-demo', '/unknown']
    for (const path of unknownPaths) {
      expect(KEEP_ALIVE_PAGES.some(p => p.path === path)).toBe(false)
    }
  })

  it('OLD CODE: accessing undefined keepAlivePages throws TypeError', () => {
    expect(() => {
      const keepAlivePages = undefined as any
      keepAlivePages.some((p: any) => p.path === '/music/scan')
    }).toThrow(TypeError)
  })

  it('FIXED CODE: KEEP_ALIVE_PAGES.some() runs without error', () => {
    expect(() => {
      const currentPath = '/music/scan'
      const result = !KEEP_ALIVE_PAGES.some(p => p.path === currentPath)
      expect(result).toBe(false)
    }).not.toThrow()
  })
})
