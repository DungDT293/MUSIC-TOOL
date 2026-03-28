/**
 * Bước 6 — Chọn audio: Trong app (playlist) hoặc Từ máy (file / thư mục).
 * Trong app: listPlaylists() → playlist + track → set store.
 * Từ máy: Chọn file nhạc (dialog) hoặc Chọn thư mục → list audio → chọn track → set store.
 */

import { useEffect, useState } from 'react'
import type { PlaylistDefinition, PlaylistTrack } from '../../types/ipc'
import { useSongNhacAudioStore } from './store/songNhacAudioStore'

type AudioSourceKind = 'app' | 'machine'

const PERSIST_KEY = 'songNhac.lastAudio'
interface PersistedAudio {
  audioFileUrl: string
  sourceKind: AudioSourceKind
  displayName: string
}

declare const window: Window & {
  api?: {
    listPlaylists: () => Promise<PlaylistDefinition[]>
    toFileUrl?: (filePath: string) => Promise<string>
    selectAudioFile: () => Promise<string | null>
    selectFolder: () => Promise<string | null>
    songNhac?: { listAudioInFolder: (folderPath: string) => Promise<{ path: string; fileName: string }[]> }
  }
}

async function pathToFileUrl(filePath: string): Promise<string> {
  if (!filePath) return ''
  try {
    if (window.api?.toFileUrl) {
      const url = await window.api.toFileUrl(filePath)
      if (url) return url
    }
    // FIX: Luôn dùng app://local-file/ thay vì file:/// (Chromium chặn file:// trong <audio>)
    return `app://local-file/?path=${encodeURIComponent(filePath)}`
  } catch (err) {
    console.error('[AudioSourceSelector] pathToFileUrl error:', err)
    // Vẫn fallback về app://local-file/ thay vì file:///
    return `app://local-file/?path=${encodeURIComponent(filePath)}`
  }
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Chuyển file:// hoặc app://local-file/?path=... thành đường dẫn hiển thị (Windows: C:\... hoặc \\server\share\... ; Unix: /...) */
function fileUrlToDisplayPath(fileUrl: string): string {
  if (!fileUrl) return fileUrl
  // app://local-file/?path=... (dùng cho phát file từ máy, kể cả UNC)
  if (fileUrl.startsWith('app://local-file/')) {
    try {
      const u = new URL(fileUrl)
      const p = u.searchParams.get('path')
      if (p) return decodeURIComponent(p)
      return fileUrl
    } catch (err) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[song-nhac][AudioSourceSelector] failed to parse app:// URL', err)
      }
      return fileUrl
    }
  }
  if (!fileUrl.startsWith('file://')) return fileUrl
  const withoutProtocol = fileUrl.replace(/^file:\/\/\//, '').replace(/^file:\/\//, '')
  try {
    const decoded = decodeURIComponent(withoutProtocol)
    return decoded.match(/^[A-Za-z]:/) ? decoded.replace(/\//g, '\\') : decoded
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[song-nhac][AudioSourceSelector] failed to decode file path', err)
    }
    return withoutProtocol
  }
}

export default function AudioSourceSelector() {
  const [sourceKind, setSourceKind] = useState<AudioSourceKind>('app')
  const [playlists, setPlaylists] = useState<PlaylistDefinition[]>([])
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null)
  const [selectedTrackPath, setSelectedTrackPath] = useState<string | null>(null)
  // Từ máy: file đã chọn hoặc thư mục + danh sách file
  const [machineFolderPath, setMachineFolderPath] = useState<string | null>(null)
  const [machineFiles, setMachineFiles] = useState<{ path: string; fileName: string }[]>([])
  const [selectedMachinePath, setSelectedMachinePath] = useState<string | null>(null)

  const setAudioSource = useSongNhacAudioStore((s) => s.setAudioSource)
  const clearAudioSource = useSongNhacAudioStore((s) => s.clearAudioSource)
  const displayName = useSongNhacAudioStore((s) => s.displayName)
  const durationSec = useSongNhacAudioStore((s) => s.durationSec)
  const audioFileUrl = useSongNhacAudioStore((s) => s.audioFileUrl)

  // Polish 3.5: restore last audio khi mở lại
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PERSIST_KEY)
      if (!raw || audioFileUrl) return
      const parsed = JSON.parse(raw) as PersistedAudio
      if (parsed.audioFileUrl && parsed.displayName) {
        setSourceKind(parsed.sourceKind)
        setAudioSource({
          audioFileUrl: parsed.audioFileUrl,
          durationSec: 0,
          displayName: parsed.displayName,
        })
      }
    } catch (err) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[song-nhac][AudioSourceSelector] failed to load persisted audio', err)
      }
    }
  }, [])

  useEffect(() => {
    let mounted = true
    window.api?.listPlaylists?.().then((data) => {
      if (!mounted) return
      setPlaylists(data ?? [])
      if (data?.length && !selectedPlaylistId) setSelectedPlaylistId(data[0].id)
    }).catch((err) => console.warn('[AudioSourceSelector] listPlaylists error', err))
    return () => { mounted = false }
  }, [])

  const selectedPlaylist = playlists.find((p) => p.id === selectedPlaylistId) ?? null
  const appTracks = selectedPlaylist?.tracks ?? []

  const persistAudio = (audioFileUrl: string, kind: AudioSourceKind, displayName: string) => {
    try {
      localStorage.setItem(PERSIST_KEY, JSON.stringify({ audioFileUrl, sourceKind: kind, displayName }))
    } catch (err) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[song-nhac][AudioSourceSelector] failed to persist audio', err)
      }
    }
  }

  const setTrackFromPath = async (path: string, fileName?: string) => {
    const fileUrl = await pathToFileUrl(path)
    if (!fileUrl) return
    const name = fileName ?? path.split(/[/\\]/).pop() ?? 'Track'
    setAudioSource({ audioFileUrl: fileUrl, durationSec: 0, displayName: name })
    persistAudio(fileUrl, 'machine', name)
  }

  const handleSelectAppTrack = async (track: PlaylistTrack) => {
    const path = track.path
    setSelectedTrackPath(path)
    const fileUrl = await pathToFileUrl(path)
    const name = track.fileName ?? path.split(/[/\\]/).pop() ?? 'Track'
    setAudioSource({
      audioFileUrl: fileUrl,
      durationSec: track.duration ?? 0,
      displayName: name,
    })
    persistAudio(fileUrl, 'app', name)
  }

  const handleSourceKindChange = (kind: AudioSourceKind) => {
    setSourceKind(kind)
    setSelectedTrackPath(null)
    setSelectedMachinePath(null)
    setMachineFolderPath(null)
    setMachineFiles([])
    clearAudioSource()
  }

  const handleChooseFile = async () => {
    const path = await window.api?.selectAudioFile?.() ?? null
    if (!path) return
    setSelectedMachinePath(path)
    setMachineFolderPath(null)
    setMachineFiles([])
    setTrackFromPath(path)
  }

  const handleChooseFolder = async () => {
    const folder = await window.api?.selectFolder?.() ?? null
    if (!folder) return
    const list = await window.api?.songNhac?.listAudioInFolder?.(folder) ?? []
    setMachineFolderPath(folder)
    setMachineFiles(list)
    setSelectedMachinePath(null)
    clearAudioSource()
    if (list.length === 1) {
      const one = list[0]
      setSelectedMachinePath(one.path)
      setTrackFromPath(one.path, one.fileName)
    }
  }

  const handleSelectMachineTrack = (path: string, fileName: string) => {
    setSelectedMachinePath(path)
    setTrackFromPath(path, fileName)
  }

  const handleClear = () => {
    try {
      localStorage.removeItem(PERSIST_KEY)
    } catch (err) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[song-nhac][AudioSourceSelector] failed to clear persisted audio', err)
      }
    }
    setSelectedTrackPath(null)
    setSelectedMachinePath(null)
    clearAudioSource()
  }

  const style = { fontSize: 12, color: 'rgba(255,255,255,0.85)' }
  const selectStyle = {
    padding: '4px 6px',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: 4,
    background: 'rgba(0,0,0,0.3)',
    color: '#e8e8e8',
    minWidth: 120,
    fontSize: 11,
  }
  const btnStyle = {
    padding: '4px 8px',
    fontSize: 11,
    border: '1px solid rgba(255,255,255,0.25)',
    borderRadius: 4,
    background: 'rgba(255,255,255,0.08)',
    color: '#e8e8e8',
    cursor: 'pointer' as const,
  }

  return (
    <div style={{ padding: 8, ...style }}>
      <div style={{ marginBottom: 6, fontWeight: 600 }}>Audio</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ minWidth: 70 }}>Nguồn</span>
          <select
            value={sourceKind}
            onChange={(e) => handleSourceKindChange(e.target.value as AudioSourceKind)}
            style={selectStyle}
          >
            <option value="app">Trong app</option>
            <option value="machine">Từ máy</option>
          </select>
        </div>

        {sourceKind === 'app' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ minWidth: 70 }}>Playlist</span>
              <select
                value={selectedPlaylistId ?? ''}
                onChange={async (e) => {
                  const id = e.target.value || null
                  setSelectedPlaylistId(id)
                  setSelectedTrackPath(null)
                  clearAudioSource()
                  if (id) {
                    const pl = playlists.find((p) => p.id === id)
                    const tracks = pl?.tracks ?? []
                    if (tracks.length === 1) {
                      const t = tracks[0]
                      setSelectedTrackPath(t.path)
                      handleSelectAppTrack(t)
                    }
                  }
                }}
                style={selectStyle}
              >
                <option value="">— Chọn —</option>
                {playlists.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ minWidth: 70 }}>Track</span>
              <select
                value={selectedTrackPath ?? ''}
                onChange={(e) => {
                  const path = e.target.value || null
                  setSelectedTrackPath(path)
                  if (!path) {
                    clearAudioSource()
                    return
                  }
                  const track = appTracks.find((t) => t.path === path)
                  if (track) handleSelectAppTrack(track)
                }}
                style={{ ...selectStyle, flex: 1 }}
              >
                <option value="">— Chọn —</option>
                {appTracks.map((t) => (
                  <option key={t.id} value={t.path}>
                    {t.fileName} ({formatDuration(t.duration ?? 0)})
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {sourceKind === 'machine' && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <button type="button" onClick={handleChooseFile} style={btnStyle}>
                Chọn file nhạc
              </button>
              <button type="button" onClick={handleChooseFolder} style={btnStyle}>
                Chọn thư mục
              </button>
            </div>
            {machineFiles.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ minWidth: 70 }}>Track</span>
                <select
                  value={selectedMachinePath ?? ''}
                  onChange={(e) => {
                    const p = e.target.value || null
                    setSelectedMachinePath(p)
                    if (!p) {
                      clearAudioSource()
                      return
                    }
                    const f = machineFiles.find((x) => x.path === p)
                    if (f) handleSelectMachineTrack(f.path, f.fileName)
                  }}
                  style={{ ...selectStyle, flex: 1 }}
                >
                  <option value="">— Chọn —</option>
                  {machineFiles.map((f) => (
                    <option key={f.path} value={f.path}>{f.fileName}</option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}

        {/* Polish 3.1: Audio status bar — tên, duration, nguồn */}
        {audioFileUrl ? (
          <div
            style={{
              padding: '6px 8px',
              background: 'rgba(0,0,0,0.2)',
              borderRadius: 4,
              fontSize: 11,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ color: 'rgba(255,255,255,0.9)' }}>🎵 {displayName ?? '—'}</span>
              {durationSec != null && durationSec > 0 ? (
                <span style={{ color: 'rgba(255,255,255,0.6)' }}>⏱️ {formatDuration(durationSec)}</span>
              ) : (
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10 }} title="Đang tải và phân tích audio...">
                  ⏳ Đang tải...
                </span>
              )}
              <span style={{ color: 'rgba(255,255,255,0.5)' }}>📁 Nguồn: {sourceKind === 'app' ? 'Trong app' : 'Từ máy'}</span>
              <button
                type="button"
                onClick={handleClear}
                style={{
                  marginLeft: 'auto',
                  padding: '2px 6px',
                  fontSize: 10,
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: 4,
                  background: 'transparent',
                  color: 'rgba(255,255,255,0.7)',
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            </div>
            {sourceKind === 'machine' && audioFileUrl && (
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, wordBreak: 'break-all' }} title={fileUrlToDisplayPath(audioFileUrl)}>
                📂 {fileUrlToDisplayPath(audioFileUrl)}
              </div>
            )}
          </div>
        ) : (
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, padding: '4px 0' }}>
            Chưa có audio — chọn playlist/track hoặc file từ máy.
          </div>
        )}
      </div>
    </div>
  )
}
