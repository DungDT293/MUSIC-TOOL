import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __autopilotTestUtils,
  getRecentAutopilotLogs,
  isAutopilotAudioDurationValid,
  splitFolderLines,
  validateAutopilotStartConfig,
  validateDateCode,
} from '../../../backend/autopilot/autopilotRunner'

const tempDirs: string[] = []

async function makeAutopilotConfig(autoCreateDailySubfolder: boolean) {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'autopilot-runner-'))
  tempDirs.push(tempRoot)

  const audioDir = path.join(tempRoot, 'audio')
  const videoDir = path.join(tempRoot, 'video')
  const finalDir = path.join(tempRoot, 'final')
  const priorityDir = path.join(tempRoot, 'priority')
  const openingDir = path.join(tempRoot, 'opening')

  await Promise.all([
    fsp.mkdir(audioDir, { recursive: true }),
    fsp.mkdir(videoDir, { recursive: true }),
    fsp.mkdir(finalDir, { recursive: true }),
    fsp.mkdir(priorityDir, { recursive: true }),
    fsp.mkdir(openingDir, { recursive: true }),
  ])

  return {
    dayPlans: [
      {
        id: 'day-1',
        dateCode: '0101',
        playlistCount: 1,
        minutesPerPlaylist: 30,
        presetId: 'custom' as const,
        overrides: {
          useCustomTitles: true,
          customTitles: ['video 1'],
        },
      },
      {
        id: 'day-2',
        dateCode: '0201',
        playlistCount: 1,
        minutesPerPlaylist: 30,
        presetId: 'custom' as const,
        overrides: {
          useCustomTitles: true,
          customTitles: ['video 1'],
        },
      },
    ],
    folders: {
      rootAudio: audioDir,
      rootVideo: videoDir,
      rootFinal: finalDir,
      priorityMusicFolder: priorityDir,
      autoCreateDailySubfolder,
    },
    openingDir,
  }
}

describe('autopilotRunner.splitFolderLines', () => {
  it('supports newline, CRLF, and semicolon delimiters', () => {
    expect(splitFolderLines('C:\\\\one; C:\\\\two\r\nC:\\\\three')).toEqual([
      'C:\\\\one',
      'C:\\\\two',
      'C:\\\\three',
    ])
  })
})

describe('autopilotRunner audio duration validation', () => {
  it('rejects a partial audio output but accepts valid Crossfade overlap', () => {
    expect(isAutopilotAudioDurationValid(174, 3900)).toBe(false)
    expect(isAutopilotAudioDurationValid(3902, 3900)).toBe(true)
    expect(isAutopilotAudioDurationValid(3970, 3972)).toBe(true)
    expect(isAutopilotAudioDurationValid(3900, 3972)).toBe(true)
    expect(isAutopilotAudioDurationValid(300, 3600)).toBe(false)
    expect(isAutopilotAudioDurationValid(3841, 3836, 0.9)).toBe(true) // rendered duration uses 90% minimum; small probe drift remains valid
    expect(isAutopilotAudioDurationValid(300, 3600, 0.9)).toBe(false) // partial output stays invalid
  })
})

describe('autopilotRunner.validateDateCode', () => {
  it('accepts leap day even when current year is not leap year', () => {
    expect(validateDateCode('2902')).toBe(true)
  })

  it('rejects impossible calendar dates', () => {
    expect(validateDateCode('3104')).toBe(false)
    expect(validateDateCode('3212')).toBe(false)
    expect(validateDateCode('0012')).toBe(false)
  })
})

describe('autopilotRunner.getRecentAutopilotLogs', () => {
  beforeEach(() => {
    __autopilotTestUtils.resetRecentLogs()
  })

  it('returns only the newest log entries up to the buffer limit', () => {
    __autopilotTestUtils.seedRecentLogs(
      Array.from({ length: 510 }, (_, index) => ({
        seq: index + 1,
        timestamp: `10:00:${String(index % 60).padStart(2, '0')}`,
        level: 'info' as const,
        message: `log-${index + 1}`,
        verbosity: 'normal' as const,
      })),
    )

    const recent = getRecentAutopilotLogs()

    expect(recent).toHaveLength(500)
    expect(recent[0]?.message).toBe('log-11')
    expect(recent[499]?.message).toBe('log-510')
  })

  it('applies an explicit limit on top of the in-memory buffer', () => {
    __autopilotTestUtils.seedRecentLogs([
      { seq: 1, timestamp: '10:00:01', level: 'info', message: 'a', verbosity: 'normal' },
      { seq: 2, timestamp: '10:00:02', level: 'warn', message: 'b', verbosity: 'verbose' },
      { seq: 3, timestamp: '10:00:03', level: 'error', message: 'c', verbosity: 'normal' },
    ])

    expect(getRecentAutopilotLogs(2).map((entry) => entry.message)).toEqual(['b', 'c'])
    expect(getRecentAutopilotLogs(0)).toEqual([])
  })

  it('keeps verbose logs in the replay buffer even when live verbosity is normal', () => {
    __autopilotTestUtils.setLogVerbosity('normal')
    __autopilotTestUtils.emitLogForTest('info', 'normal-log')
    __autopilotTestUtils.emitLogForTest('info', 'verbose-log', 'verbose')

    expect(
      getRecentAutopilotLogs().map((entry) => ({
        seq: entry.seq,
        message: entry.message,
        verbosity: entry.verbosity,
      })),
    ).toEqual([
      { seq: 1, message: 'normal-log', verbosity: 'normal' },
      { seq: 2, message: 'verbose-log', verbosity: 'verbose' },
    ])
  })
})

describe('autopilotRunner.validateAutopilotStartConfig', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) =>
        fsp.rm(dir, { recursive: true, force: true }),
      ),
    )
  })

  it('rejects projected output collisions across days when daily subfolders are disabled', async () => {
    const config = await makeAutopilotConfig(false)

    await expect(validateAutopilotStartConfig(config as any)).rejects.toThrow(
      'autoCreateDailySubfolder',
    )
  })

  it('allows semicolon and CRLF video roots when at least one exists', async () => {
    const config = await makeAutopilotConfig(true)
    const missingVideoDir = path.join(path.dirname(config.folders.rootVideo), 'missing-video')
    config.folders.rootVideo = `${missingVideoDir};\r\n${config.folders.rootVideo}`

    await expect(validateAutopilotStartConfig(config as any)).resolves.toMatchObject({
      validPlans: expect.any(Array),
    })
  })

  it('validates and returns optional opening folder', async () => {
    const config = await makeAutopilotConfig(true)
    config.folders.openingMusicFolder = config.openingDir

    await expect(validateAutopilotStartConfig(config as any)).resolves.toMatchObject({
      openingFolder: config.openingDir,
    })
  })

  it('rejects missing opening folder with actionable label', async () => {
    const config = await makeAutopilotConfig(true)
    config.folders.openingMusicFolder = path.join(path.dirname(config.openingDir), 'missing-opening')

    await expect(validateAutopilotStartConfig(config as any)).rejects.toThrow('Thu muc nhac mo dau')
  })

  it('keeps opening folder optional for old configs', async () => {
    const config = await makeAutopilotConfig(true)

    await expect(validateAutopilotStartConfig(config as any)).resolves.toMatchObject({
      openingFolder: null,
    })
  })

  it('rejects video roots when every delimited path is invalid', async () => {
    const config = await makeAutopilotConfig(true)
    const missingRoot = path.dirname(config.folders.rootVideo)
    config.folders.rootVideo = `${path.join(missingRoot, 'missing-one')};${path.join(missingRoot, 'missing-two')}`

    await expect(validateAutopilotStartConfig(config as any)).rejects.toThrow('Thư mục gốc Video đã cắt')
  })
})

describe('Autopilot - exportAudio scanResult in-memory synchronization', () => {
  it('exportPlaylistToFile uses req.scanResult instead of disk scanStore when provided', async () => {
    const { exportPlaylistToFile } = await import('../../../backend/music/exportAudio')
    const playlistEngine = await import('../../../backend/music/playlistEngine')
    const scanStore = await import('../../../backend/music/scanStore')
    const probe = await import('../../../backend/ffmpeg/probe')
    const ffmpegWrapper = await import('../../../backend/ffmpeg/wrapper')

    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'autopilot-sync-'))
    tempDirs.push(tempRoot)
    const outDir = path.join(tempRoot, 'out')
    await fsp.mkdir(outDir, { recursive: true })

    const autoTrack1 = path.join(tempRoot, 'auto1.m4a')
    const autoTrack2 = path.join(tempRoot, 'auto2.m4a')
    const autoFiller = path.join(tempRoot, 'auto_filler.m4a')
    await Promise.all([
      fsp.writeFile(autoTrack1, 'a1'),
      fsp.writeFile(autoTrack2, 'a2'),
      fsp.writeFile(autoFiller, 'af'),
    ])

    const autopilotScanResult: any = {
      tracks: [
        { id: 'a1', path: autoTrack1, fileName: 'auto1.m4a', folderType: 'priority', genreId: 'autopilot', genreName: 'Autopilot', duration: 60, size: 10, codec: 'aac' },
        { id: 'a2', path: autoTrack2, fileName: 'auto2.m4a', folderType: 'priority', genreId: 'autopilot', genreName: 'Autopilot', duration: 60, size: 10, codec: 'aac' },
        { id: 'af', path: autoFiller, fileName: 'auto_filler.m4a', folderType: 'random', genreId: 'autopilot', genreName: 'Autopilot', duration: 60, size: 10, codec: 'aac' },
      ],
      summary: { priorityCount: 2, randomCount: 1, totalCount: 3, priorityDuration: 120, randomDuration: 60, totalDuration: 180 },
    }

    // Disk store has completely unrelated tracks (e.g. from an old manual scan)
    const diskScanResult: any = {
      tracks: [
        { id: 'intruder', path: path.join(tempRoot, 'intruder.m4a'), fileName: 'intruder.m4a', folderType: 'priority', genreId: 'other', genreName: 'Other', duration: 100, size: 10, codec: 'aac' },
      ],
      summary: { priorityCount: 1, randomCount: 0, totalCount: 1, priorityDuration: 100, randomDuration: 0, totalDuration: 100 },
    }
    const { vi } = await import('vitest')
    vi.spyOn(scanStore, 'loadScanResult').mockReturnValue(diskScanResult)
    vi.spyOn(probe, 'probeFile').mockResolvedValue({ format: { duration: 180, size: 1000 }, audio: { codec: 'aac' } } as any)
    vi.spyOn(ffmpegWrapper, 'runFfmpeg').mockImplementation(async ({ args }: any) => {
      const out = args?.[args.length - 1]
      if (out && typeof out === 'string' && !out.startsWith('-')) {
        await fsp.writeFile(out, 'fake out')
      }
      return { code: 0, stdout: '', stderr: '' } as any
    })

    const mockPlaylist: any = {
      id: 'pl-auto-1',
      name: 'Autopilot - Playlist 1',
      targetDurationSec: 180,
      totalDurationSec: 120,
      priorityDurationSec: 120,
      randomDurationSec: 0,
      priorityCount: 2,
      randomCount: 0,
      genreId: 'autopilot',
      genreName: 'Autopilot',
      genreSettings: { smoothTransitions: true, crossfadeDurationSec: 4, normalizeLoudness: false },
      createdAt: Date.now(),
      tracks: [
        { ...autopilotScanResult.tracks[0], order: 1, cumulativeDuration: 60 },
        { ...autopilotScanResult.tracks[1], order: 2, cumulativeDuration: 120 },
      ],
    }
    vi.spyOn(playlistEngine, 'getPlaylistById').mockReturnValue(mockPlaylist)

    const result = await exportPlaylistToFile({
      playlistId: 'pl-auto-1',
      outputDir: outDir,
      fileName: '0212_P01',
      format: 'aac',
      bitrateKbps: 384,
      smoothTransitions: true,
      crossfadeDurationSec: 4,
      scanResult: autopilotScanResult,
    })

    expect(result.success).toBe(true)
    const runFfmpegMock = vi.mocked(ffmpegWrapper.runFfmpeg)
    const lastCall = runFfmpegMock.mock.calls[runFfmpegMock.mock.calls.length - 1]?.[0]
    // Verify that the filler track picked is autoFiller, NOT the intruder from disk!
    expect(lastCall.args).toContain(autoFiller)
    expect(lastCall.args.join(' ')).not.toContain('intruder.m4a')
  })
})
