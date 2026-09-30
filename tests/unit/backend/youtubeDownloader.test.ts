import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('child_process', () => ({ spawn: spawnMock }))
vi.mock('../../../backend/ffmpeg/config', () => ({
  getFfmpegPaths: () => ({
    ffmpeg: path.join('C:', 'bundled', 'ffmpeg.exe'),
    ffprobe: path.join('C:', 'bundled', 'ffprobe.exe'),
  }),
}))

import { YouTubeDownloader } from '../../../backend/youtube/youtubeDownloader'

function fakeProcess(output = '', stream: 'stdout' | 'stderr' = 'stderr') {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()

  queueMicrotask(() => {
    if (output) child[stream].emit('data', Buffer.from(output))
    child.emit('close', 0)
  })
  return child
}

async function tempDir() {
  return mkdtemp(path.join(tmpdir(), 'youtube-downloader-'))
}

describe('YouTubeDownloader output parser', () => {
  it('parses source and post-processed audio destinations', () => {
    expect(YouTubeDownloader.extractOutputPaths([
      '[download] Destination: C:\\downloads\\source.webm',
      '[ExtractAudio] Destination: C:\\downloads\\final.mp3',
    ].join('\n'))).toEqual([
      'C:\\downloads\\source.webm',
      'C:\\downloads\\final.mp3',
    ])
  })

  it('prioritizes yt-dlp final path marker over intermediate destinations', () => {
    expect(YouTubeDownloader.extractOutputPaths([
      '[download] Destination: C:\\downloads\\source.webm',
      '[Merger] Merging formats into "C:\\downloads\\final.mp4"',
      '__YT_DLP_FINAL__C:\\downloads\\final.mp4',
    ].join('\n'))).toEqual([
      'C:\\downloads\\final.mp4',
      'C:\\downloads\\source.webm',
      'C:\\downloads\\final.mp4',
    ])
  })

  it('parses merger destination and quotes safely', () => {
    expect(YouTubeDownloader.extractOutputPaths('[Merger] Merging formats into "C:\\downloads\\final.mp4"')).toEqual([
      'C:\\downloads\\final.mp4',
    ])
  })
})

describe('YouTubeDownloader Spotify matching', () => {
  it('requires artist and title tokens and penalizes live or cover results', () => {
    const track = { id: 'track-1', name: 'Dreams', artists: ['Fleetwood Mac'] }
    expect(YouTubeDownloader.scoreSpotifyYouTubeResult(track, 'Fleetwood Mac - Dreams', 'Fleetwood Mac')).toBeGreaterThanOrEqual(90)
    expect(YouTubeDownloader.scoreSpotifyYouTubeResult(track, 'Dreams live cover', 'Unknown')).toBe(0)
  })
})

describe('YouTubeDownloader TikTok URL routing', () => {
  it('treats TikTok video URL with creator handle as video', () => {
    const downloader = Object.create(YouTubeDownloader.prototype) as YouTubeDownloader
    expect(downloader.detectUrlType('https://www.tiktok.com/@creator/video/7664222020757998870')).toBe('video')
  })
})

describe('YouTubeDownloader TikTok fallback policy', () => {
  it('matches only universal-data rehydration failure', () => {
    expect(YouTubeDownloader.isTikTokRehydrationError(
      '[TikTok] Unable to extract universal data for rehydration; please report this issue',
    )).toBe(true)
    expect(YouTubeDownloader.isTikTokRehydrationError(
      '[TikTok] Unexpected response from webpage request',
    )).toBe(true)
    expect(YouTubeDownloader.isTikTokRehydrationError('Private video')).toBe(false)
    expect(YouTubeDownloader.isTikTokRehydrationError('HTTP Error 429')).toBe(false)
  })
})

describe('YouTubeDownloader completed output discovery', () => {
  let directories: string[]

  beforeEach(() => {
    directories = []
    spawnMock.mockReset()
    spawnMock.mockImplementation((_command: string, args: string[]) => {
      if (args.includes('--version')) return fakeProcess('test\n')
      return fakeProcess()
    })
  })

  afterEach(async () => {
    await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })))
  })

  it('finds fresh Unicode audio beneath uploader folder when log path is corrupted', async () => {
    const outputDir = await tempDir()
    directories.push(outputDir)
    const audioDir = path.join(outputDir, 'Người tạo')
    const audioPath = path.join(audioDir, 'Bài hát.mp3')
    await mkdir(audioDir, { recursive: true })
    await writeFile(audioPath, 'audio')
    await utimes(audioPath, new Date(), new Date(Date.now() + 1_000))

    const downloader = Object.create(YouTubeDownloader.prototype) as YouTubeDownloader
    const result = await (downloader as any).resolveDownloadOutput(
      [path.join(outputDir, 'Người t�o', 'B�i h�t.mp3')],
      outputDir,
      true,
      'mp3',
      Date.now(),
    )

    expect(result).toBe(audioPath)
  })

  it('uses TikTok args without YouTube referer or extractor client', async () => {
    const outputDir = await tempDir()
    directories.push(outputDir)
    const audioDir = path.join(outputDir, 'davidguetta')
    const audioPath = path.join(audioDir, 'Bài hát.mp3')
    await mkdir(audioDir, { recursive: true })
    await writeFile(audioPath, 'audio')

    const url = 'https://www.tiktok.com/@davidguetta/video/7666030136571022625'
    spawnMock.mockImplementation((_command: string, args: string[]) => {
      if (args.includes('--version')) return fakeProcess('test\n')
      return fakeProcess(`[ExtractAudio] Destination: ${audioPath}\n`)
    })

    const downloader = new YouTubeDownloader()
    vi.spyOn(downloader as any, 'validateDownloadRequest').mockResolvedValue(undefined)
    vi.spyOn(downloader as any, 'resolveCookieArgsForYtDlp').mockResolvedValue({ args: [], cleanup: () => {} })

    await expect(downloader.downloadVideo({
      url,
      outputDir,
      quality: '1080',
      downloadSubtitles: false,
      downloadThumbnail: false,
      audioOnly: true,
      audioFormat: 'mp3',
    })).resolves.toBe(audioPath)

    const downloadArgs = spawnMock.mock.calls.find(([, args]) => args.includes(url))?.[1] as string[]
    expect(downloadArgs).toContain('Referer:https://www.tiktok.com/')
    expect(downloadArgs).not.toContain('https://www.youtube.com/')
    expect(downloadArgs).not.toContain('youtube:player_client=tv,android_vr,web_safari')
  })

  it('uses TikTok metadata args without a YouTube client', async () => {
    const url = 'https://www.tiktok.com/@davidguetta/video/7666030136571022625'
    const info = {
      id: '7666030136571022625',
      title: 'TikTok',
      duration: 1,
      thumbnail: '',
      description: '',
      uploader: 'davidguetta',
      upload_date: '',
      view_count: 0,
      like_count: 0,
      width: 0,
      height: 0,
      formats: [],
    }
    spawnMock.mockImplementation((_command: string, args: string[]) => {
      if (args.includes('--version')) return fakeProcess('test\n')
      return fakeProcess(`${JSON.stringify(info)}\n`, 'stdout')
    })

    const downloader = new YouTubeDownloader()
    await expect(downloader.getVideoInfo(url)).resolves.toMatchObject({ id: info.id })

    const infoArgs = spawnMock.mock.calls.find(([, args]) => args.includes(url))?.[1] as string[]
    expect(infoArgs).toContain('https://www.tiktok.com/')
    expect(infoArgs).toContain('tiktok:webpage_url_basename=t')
    expect(infoArgs).not.toContain('https://www.youtube.com/')
    expect(infoArgs).not.toContain('youtube:player_client=tiktok')
  })

  it('uses bundled FFmpeg and fresh Unicode fallback for sequential audio downloads', async () => {
    const videosFolder = await tempDir()
    directories.push(videosFolder)
    const audioPath = path.join(videosFolder, 'Bài hát.mp3')
    await writeFile(audioPath, 'audio')
    await utimes(audioPath, new Date(), new Date(Date.now() + 1_000))

    const url = 'https://www.youtube.com/watch?v=test'
    spawnMock.mockImplementation((_command: string, args: string[]) => {
      if (args.includes('--version')) return fakeProcess('test\n')
      return fakeProcess(`[ExtractAudio] Destination: ${path.join(videosFolder, 'B�i h�t.mp3')}\n`)
    })

    const downloader = new YouTubeDownloader()
    await expect((downloader as any).downloadVideoToFolder(
      url,
      videosFolder,
      undefined,
      '1080',
      false,
      false,
      true,
      'mp3',
      [],
    )).resolves.toBe(audioPath)

    const downloadArgs = spawnMock.mock.calls.find(([, args]) => args.includes(url))?.[1] as string[]
    expect(downloadArgs).toContain('--ffmpeg-location')
  })
})
