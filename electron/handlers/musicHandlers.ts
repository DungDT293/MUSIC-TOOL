/**
 * musicHandlers.ts
 * IPC handlers: music:*, preset:*
 */

import { ipcMain } from 'electron'
import { scanMusicFolders } from '../../backend/music/scanMusic'
import { loadScanResult } from '../../backend/music/scanStore'
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
import { getSpotifyMeta } from '../../backend/music/spotifyMeta'
import { getRecentHistory, deleteHistoryEntries, downloadPlaylistHistory as downloadHistoryByDates } from '../../backend/music/exportHistory'
import { listPresets, savePreset, updatePreset, deletePreset } from '../../backend/exportPresets'
import { applySeoMetadata, type SeoMetadataRequest } from '../../backend/video/seoMetadata'
import { jobQueue } from '../../backend/jobQueue/jobQueue'
import { videoJobManager } from '../../backend/video/videoJobManager'
import { confirmResourcesForVideoJob } from './systemHandlers'

export function registerMusicHandlers(mainWindow: Electron.BrowserWindow | null) {
  // Music scan
  ipcMain.handle('music:scanFolders', async (_event, payload) => {
    console.log('[IPC] music:scanFolders', payload)
    clearPlaylists()
    console.log('[IPC] Cleared old playlists due to new scan')
    return scanMusicFolders(payload)
  })

  // Create playlists
  ipcMain.handle('music:createPlaylists', async (_event, payload: BuildPlaylistsOptions): Promise<BuildPlaylistsResult> => {
    console.log('[IPC] music:createPlaylists', {
      tracks: payload.tracks?.length,
      pinned: payload.pinnedTrackIds?.length,
      playlistCount: payload.playlistCount,
      targetMinutes: payload.targetDurationMinutes,
    })
    registerTracks(payload.tracks ?? [])
    const result = buildPlaylists(payload)
    savePlaylists(result.playlists)
    return result
  })

  ipcMain.handle('music:listPlaylists', async () => getPlaylists())
  ipcMain.handle('music:getPoolStats', async (_event, trackIds: string[]) => getMusicPoolStats(trackIds ?? []))
  ipcMain.handle('music:clearPool', async () => { clearMusicPool(); return { success: true } })
  ipcMain.handle('music:getLastScan', async () => loadScanResult())

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

  ipcMain.handle('music:downloadPlaylistHistory', async (_event, dates: string[], outputDir?: string) => {
    try {
      const result = downloadHistoryByDates(dates ?? [], outputDir)
      return {
        success: result.success,
        downloadedCount: result.savedFiles.length,
        outputDir: outputDir || '',
        savedFiles: result.savedFiles,
      }
    } catch (err) {
      console.error('[IPC] music:downloadPlaylistHistory error', err)
      return { success: false, downloadedCount: 0, outputDir: '', error: String(err) }
    }
  })

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

  // SEO metadata
  ipcMain.handle('video:seo:apply', async (_event, payload: SeoMetadataRequest) => {
    try {
      return await applySeoMetadata(payload)
    } catch (err: any) {
      console.error('[IPC] video:seo:apply error', err)
      return { error: err?.message || String(err) }
    }
  })

  // Export playlist
  const EXPORT_PROGRESS_CHANNEL = 'music:exportProgress'

  ipcMain.handle('music:exportPlaylist', async (event, req: ExportPlaylistRequest) => {
    console.log('[IPC] music:exportPlaylist', req)

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
    const jobHandle = jobQueue.enqueue<ExportPlaylistResult>({
      type: 'music:export-playlist',
      payload: {
        playlistId: req.playlistId,
        outputPath: (req as any)?.outputPath,
        playlistName: (req as any)?.playlistName,
        currentIndex: (req as any)?.currentIndex,
        totalCount: (req as any)?.totalCount,
      },
      onCancel: (jobId) => { videoJobManager.cancelJob(jobId) },
      task: async (ctx) => {
        const result = await exportPlaylistToFile(
          { ...req, requestId: ctx.jobId, signal: ctx.signal } as any,
          (progress) => {
            const progressPercent =
              progress.percent ??
              (progress.totalSec && progress.totalSec > 0
                ? (progress.currentSec / progress.totalSec) * 100
                : undefined)
            ctx.updateProgress(progressPercent, 'Exporting playlist')
            sender.send(EXPORT_PROGRESS_CHANNEL, { ...progress, requestId: ctx.jobId })
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
          if (pl) markTracksUsed(pl.tracks.map(t => t.id))
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
        sender.send(progressChannel, progress)
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
      console.log('[IPC] music:spotifyMeta', spotifyUrl)
      return await getSpotifyMeta(spotifyUrl)
    } catch (err: any) {
      console.error('[IPC] music:spotifyMeta error', err)
      return { success: false, error: err?.message || String(err) }
    }
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
