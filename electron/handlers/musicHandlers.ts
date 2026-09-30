/**
 * musicHandlers.ts
 * IPC handlers: music:*, preset:*
 */

import { ipcMain } from 'electron'
import { scanMusicFolders, type MusicScanGenre } from '../../backend/music/scanMusic'
import { loadUsableScanResult } from '../../backend/music/scanStore'
import { MusicScanFoldersSchema } from '../../shared/ipcSchemas'
import {
  buildPlaylists,
  savePlaylists,
  getPlaylists,
  getPlaylistById,
  clearPlaylists,
  type BuildPlaylistsOptions,
  type BuildPlaylistsResult,
} from '../../backend/music/playlistEngine'
import { markTracksUsed, registerTracks, getMusicPoolStats, clearMusicPool } from '../../backend/music/musicPool'
import {
  exportPlaylistToFile,
  validatePlaylistsForCrossfade,
  type ExportPlaylistRequest,
  type ExportPlaylistResult,
  type ValidatePlaylistsForCrossfadeRequest,
  type ValidatePlaylistsForCrossfadeResult,
} from '../../backend/music/exportAudio'
import { normalizeAudio, cancelNormalizeAudio, type NormalizeAudioRequest, type NormalizeAudioProgress } from '../../backend/music/normalizeAudio'
import { enhanceAudio, cancelEnhanceAudio, renderPreviewClip, type EnhanceAudioRequest } from '../../backend/music/enhanceAudio/index'
import { getSpotifyMeta, resolveBrowserSpotifyMetadata, resolvePublicSpotifyMetadata, resolveSpotifyMetadata } from '../../backend/music/spotifyMeta'
import { readSpotifyPlaylistWithBrowser } from '../spotifyMetadataBrowser'
import { getSpotifyCookieString, getSpotifyCookies } from '../youtube/youtubeHandlers'
import { SpotifyMetadataRequestSchema, type SpotifyMetadataResult } from '../../shared/ipcSchemas'
import { getRecentHistory, deleteHistoryEntries, downloadPlaylistHistory as downloadHistoryByDates } from '../../backend/music/exportHistory'
import { listPresets, savePreset, updatePreset, deletePreset } from '../../backend/exportPresets'
import { jobQueue } from '../../backend/jobQueue/jobQueue'
import { videoJobManager } from '../../backend/video/videoJobManager'
import { confirmResourcesForVideoJob } from './systemHandlers'
import { isValidAbsolutePath } from '../authState'

// FIX BUG 28: Dùng getter thay vì tham chiếu cũ để mainWindow luôn được cập nhật
export function registerMusicHandlers(getMainWindow: () => Electron.BrowserWindow | null) {
  // Music scan
  ipcMain.handle('music:scanFolders', async (_event, payload) => {
    const parsed = MusicScanFoldersSchema.parse(payload)

    const validateFolder = (folder: string, label: string) => {
      if (folder && !isValidAbsolutePath(folder)) {
        throw new Error(`Invalid ${label} folder path`)
      }
    }

    validateFolder(parsed.priorityFolder ?? '', 'priority')
    validateFolder(parsed.randomFolder ?? '', 'random')
    for (const genre of parsed.genres ?? []) {
      for (const folder of genre.priorityFolders ?? []) validateFolder(folder, `${genre.name} priority`)
      for (const folder of genre.randomFolders ?? []) validateFolder(folder, `${genre.name} random`)
      for (const folder of genre.openingFolders ?? []) validateFolder(folder, `${genre.name} opening`)
    }

    console.log('[IPC] music:scanFolders', {
      legacy: Boolean(parsed.priorityFolder || parsed.randomFolder),
      genres: parsed.genres?.length ?? 0,
      forceRescan: parsed.forceRescan,
    })

    const result = await scanMusicFolders({
      priorityFolder: parsed.priorityFolder,
      randomFolder: parsed.randomFolder,
      genres: parsed.genres as MusicScanGenre[] | undefined,
      forceRescan: parsed.forceRescan,
    })

    if (result.cacheStatus === 'scanned') {
      clearPlaylists()
      console.log('[IPC] Cleared old playlists due to new scan')
    }
    return result
  })

  // Create playlists
  ipcMain.handle('music:createPlaylists', async (_event, payload: BuildPlaylistsOptions): Promise<BuildPlaylistsResult> => {
    for (const track of payload.openingTracks ?? []) {
      if (track?.path && !isValidAbsolutePath(track.path)) {
        throw new Error('Invalid opening audio path')
      }
    }
    for (const track of payload.endingTracks ?? []) {
      if (track?.path && !isValidAbsolutePath(track.path)) {
        throw new Error('Invalid ending audio path')
      }
    }
    console.log('[IPC] music:createPlaylists', {
      tracks: payload.tracks?.length,
      pinned: payload.pinnedTrackIds?.length,
      ending: payload.endingTracks?.length ?? 0,
      playlistCount: payload.playlistCount,
      targetMinutes: payload.targetDurationMinutes,
    })
    const endingPathSet = new Set((payload.endingTracks ?? []).map(t => t.path?.toLowerCase()).filter(Boolean))
    registerTracks((payload.tracks ?? []).filter(t => !endingPathSet.has(t.path?.toLowerCase())))
    const result = buildPlaylists(payload)
    const taggedPlaylists = result.playlists.map((playlist) => ({
      ...playlist,
      genreId: payload.genreId,
      genreName: payload.genreName,
      genreSettings: payload.genreSettings,
    }))
    const existing = getPlaylists()
    const retained = payload.genreId
      ? existing.filter((playlist) => playlist.genreId !== payload.genreId)
      : payload.replaceExisting === false ? existing : []
    savePlaylists([...retained, ...taggedPlaylists])
    return { ...result, playlists: taggedPlaylists }
  })

  ipcMain.handle('music:listPlaylists', async () => getPlaylists())
  ipcMain.handle('music:getPoolStats', async (_event, trackIds: string[]) => getMusicPoolStats(trackIds ?? []))
  ipcMain.handle('music:clearPool', async () => { clearMusicPool(); return { success: true } })
  ipcMain.handle('music:getLastScan', async () => loadUsableScanResult())

  // Export history
  ipcMain.handle('music:getExportHistory', async () => {
    try { return getRecentHistory() }
    catch (err) { console.error('[IPC] music:getExportHistory error', err); return [] }
  })

  ipcMain.handle('music:deleteExportHistory', async (_event, ids: string[]) => {
    try {
      const result = deleteHistoryEntries(ids ?? [])
      return { success: true, deletedCount: result.deleted }
    } catch (err) {
      console.error('[IPC] music:deleteExportHistory error', err)
      return { success: false, deletedCount: 0, error: String(err) }
    }
  })

  ipcMain.handle(
    'music:downloadPlaylistHistory',
    async (_event, payload: { dates?: string[]; entryIds?: string[]; outputDir?: string }) => {
      const outputDir = payload?.outputDir
      if (outputDir && !isValidAbsolutePath(outputDir)) {
        return { success: false, downloadedCount: 0, outputDir: '', error: 'Invalid output directory path' }
      }
      try {
        const result = downloadHistoryByDates({
          dates: payload?.dates ?? [],
          entryIds: payload?.entryIds ?? [],
          outputDir,
        })
        return {
          success: result.success,
          downloadedCount: result.savedFiles.length,
          outputDir: result.outputDir,
          savedFiles: result.savedFiles,
        }
      } catch (err) {
        console.error('[IPC] music:downloadPlaylistHistory error', err)
        return { success: false, downloadedCount: 0, outputDir: '', error: String(err) }
      }
    }
  )

  // Audio Enhancement
  const ENHANCE_PROGRESS_CH = 'music:enhance:progress'

  ipcMain.handle('music:enhance:run', async (event, req: EnhanceAudioRequest) => {
    try {
      return await enhanceAudio(req, (p) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(ENHANCE_PROGRESS_CH, p)
        }
      })
    } catch (err) {
      console.error('[IPC] music:enhance:run error', err)
      return { success: false, processed: 0, failed: 1, errors: [{ file: '', error: String(err) }], outputFiles: [] }
    }
  })

  ipcMain.handle('music:enhance:cancel', async () => {
    try { cancelEnhanceAudio(); return { ok: true } }
    catch (err) { console.error('[IPC] music:enhance:cancel error', err); return { ok: false } }
  })

  ipcMain.handle('music:enhance:renderPreview', async (_event, opts) => {
    if (opts?.inputFile && !isValidAbsolutePath(opts.inputFile)) {
      return { success: false, error: 'Invalid input file path' }
    }
    try {
      const reshaped = opts?.loudnorm
        ? opts
        : {
            inputFile: opts.inputFile,
            loudnorm: {
              enabled: true,
              integratedLufs: opts.integratedLufs ?? -14,
              truePeakDbtp: opts.truePeakDbtp ?? -1,
              lra: opts.lra ?? 11,
            },
            durationSec: opts.durationSec,
            startSec: opts.startSec,
          }
      return await renderPreviewClip(reshaped)
    } catch (err) {
      console.error('[IPC] music:enhance:renderPreview error', err)
      return { success: false, error: String(err) }
    }
  })

  // Export playlist
  const EXPORT_PROGRESS_CHANNEL = 'music:exportProgress'

  ipcMain.handle('music:exportPlaylist', async (event, req: ExportPlaylistRequest) => {
    if (req.outputDir && !isValidAbsolutePath(req.outputDir)) {
      return { success: false, error: 'Invalid output directory path', outputPath: '' }
    }
    console.log('[IPC] music:exportPlaylist', req)

    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      const proceed = await confirmResourcesForVideoJob('final-export', req.outputDir)
      if (!proceed) {
        return {
          success: false,
          error: 'Người dùng đã hủy xuất nhạc sau cảnh báo tài nguyên.',
          requestId: '',
        }
      }
    }

    const sender = event.sender
    const reqWithMeta = req as ExportPlaylistRequest & Partial<{
      outputPath: string
      playlistName: string
      currentIndex: number
      totalCount: number
    }>
    const jobHandle = jobQueue.enqueue<ExportPlaylistResult>({
      type: 'music:export-playlist',
      payload: {
        playlistId: req.playlistId,
        outputPath: reqWithMeta.outputPath,
        playlistName: reqWithMeta.playlistName,
        currentIndex: reqWithMeta.currentIndex,
        totalCount: reqWithMeta.totalCount,
      },
      onCancel: (jobId) => { videoJobManager.cancelJob(jobId) },
      task: async (ctx) => {
        const result = await exportPlaylistToFile(
          { ...req, requestId: ctx.jobId, signal: ctx.signal },
          (progress) => {
            const progressPercent =
              progress.percent ??
              (progress.totalSec && progress.totalSec > 0
                ? (progress.currentSec / progress.totalSec) * 100
                : undefined)
            ctx.updateProgress(progressPercent, 'Exporting playlist')
            if (!sender.isDestroyed()) {
              sender.send(EXPORT_PROGRESS_CHANNEL, { ...progress, requestId: ctx.jobId })
            }
          }
        )
        return result
      },
    })

    try {
      const result = await jobHandle.result
      if (result.success) {
        try {
          const pl = getPlaylistById(req.playlistId)
          if (pl) markTracksUsed(pl.tracks.filter(t => t.role !== 'ending').map(t => t.id))
        } catch (poolErr) {
          console.warn('[IPC] music:exportPlaylist - markTracksUsed failed (non-fatal):', poolErr)
        }
      }
      return { ...result, requestId: jobHandle.jobId }
    } catch (err: any) {
      console.error('[IPC] music:exportPlaylist error', err)
      return {
        success: false,
        error: err?.message || 'Lỗi không xác định khi xuất playlist.',
        requestId: jobHandle.jobId,
      } satisfies ExportPlaylistResult & { requestId: string }
    }
  })

  // Validate playlists for crossfade
  ipcMain.removeHandler('music:validatePlaylistsForCrossfade')
  ipcMain.handle('music:validatePlaylistsForCrossfade', async (_event, req: ValidatePlaylistsForCrossfadeRequest) => {
    try {
      console.log('[IPC] music:validatePlaylistsForCrossfade', req)
      return await validatePlaylistsForCrossfade(req)
    } catch (err: any) {
      console.error('[IPC] music:validatePlaylistsForCrossfade error', err)
      return { results: [], totalChecked: 0, totalWithIssues: 0 } satisfies ValidatePlaylistsForCrossfadeResult
    }
  })

  // Normalize audio
  ipcMain.handle('music:normalizeAudio', async (event, req: NormalizeAudioRequest) => {
    console.log('[IPC] music:normalizeAudio', req)
    const sender = event.sender
    const progressChannel = 'music:normalizeAudio:progress'
    try {
      return await normalizeAudio(req, (progress: NormalizeAudioProgress) => {
        // FIX BUG 26: Check isDestroyed trước khi send progress
        if (!sender.isDestroyed()) {
          sender.send(progressChannel, progress)
        }
      })
    } catch (err: any) {
      console.error('[IPC] music:normalizeAudio error', err)
      return {
        success: false, processed: 0, failed: 0,
        errors: [{ file: '', error: err?.message || 'Lỗi không xác định' }],
        outputFiles: [],
      }
    }
  })

  ipcMain.handle('music:normalizeAudio:cancel', async () => {
    cancelNormalizeAudio()
    return { ok: true }
  })

  // Spotify metadata
  ipcMain.handle('music:spotifyMeta', async (_event, spotifyUrl: string) => {
    try {
      console.log('[IPC] music:spotifyMeta')
      return await getSpotifyMeta(spotifyUrl)
    } catch (err: unknown) {
      console.error('[IPC] music:spotifyMeta error', err instanceof Error ? err.message : 'unknown error')
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('music:spotifyImport', async (_event, payload: unknown): Promise<SpotifyMetadataResult> => {
    const parsed = SpotifyMetadataRequestSchema.safeParse(payload)
    if (!parsed.success) {
      return { success: false, error: { code: 'invalid', message: 'Invalid Spotify metadata request.' } }
    }
    const spotifyCookies = getSpotifyCookieString()
    if (spotifyCookies) {
      const browserResult = await resolveBrowserSpotifyMetadata(parsed.data.url, {
        readTracks: async (parsedUrl) => readSpotifyPlaylistWithBrowser(parsedUrl, getSpotifyCookies()),
      })
      if (browserResult.success || !process.env.SPOTIFY_ACCESS_TOKEN) return browserResult
    }
    const publicResult = await resolvePublicSpotifyMetadata(parsed.data.url, {
      cookieString: spotifyCookies,
    })
    if (publicResult.success || !process.env.SPOTIFY_ACCESS_TOKEN) return publicResult
    return resolveSpotifyMetadata(parsed.data.url, {
      pageLimit: parsed.data.pageLimit,
      getAccessToken: () => process.env.SPOTIFY_ACCESS_TOKEN,
    })
  })

  // Export Presets
  ipcMain.handle('preset:list', async () => {
    try { return { success: true, presets: listPresets() } }
    catch (err: any) { return { success: false, error: err?.message } }
  })
  ipcMain.handle('preset:save', async (_event, name: string, settings: any) => {
    try { return { success: true, preset: savePreset(name, settings) } }
    catch (err: any) { return { success: false, error: err?.message } }
  })
  ipcMain.handle('preset:update', async (_event, id: string, name: string, settings: any) => {
    try { return { success: true, preset: updatePreset(id, name, settings) } }
    catch (err: any) { return { success: false, error: err?.message } }
  })
  ipcMain.handle('preset:delete', async (_event, id: string) => {
    try { return { success: true, deleted: deletePreset(id) } }
    catch (err: any) { return { success: false, error: err?.message } }
  })
}
