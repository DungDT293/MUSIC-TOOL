import { useState, useEffect, useMemo } from 'react'
import { ScanMusicResult, type MusicScanGenre } from '../../types/ipc'

function formatDuration(seconds: number): string {
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
  }
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function formatDurationShort(seconds: number): string {
  const s = Math.floor(seconds)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function getFolderTypeLabel(type?: string): { label: string; color: string } {
  if (type === 'priority') return { label: 'Nhạc ưu tiên', color: '#38bdf8' }
  if (type === 'opening') return { label: 'Nhạc mở đầu', color: '#f472b6' }
  return { label: 'Nhạc ngẫu nhiên', color: '#4ade80' }
}

const SCAN_RESULT_STORAGE_KEY = 'scanResultV1'
const SCAN_CONFIG_STORAGE_KEY = 'scanMusicConfigV1'
let scanGenreCounter = 1

function loadSavedGenres(): MusicScanGenre[] {
  try {
    const raw = localStorage.getItem(SCAN_CONFIG_STORAGE_KEY)
    if (!raw) return [createDefaultGenre()]
    const parsed = JSON.parse(raw)
    const savedGenres = Array.isArray(parsed?.genres) ? parsed.genres : parsed
    return Array.isArray(savedGenres) && savedGenres.length > 0
      ? savedGenres.map((genre: MusicScanGenre, index: number) => ({
          ...createDefaultGenre(`Thể loại ${index + 1}`),
          ...genre,
          priorityFolders: Array.isArray(genre.priorityFolders) ? genre.priorityFolders : [],
          randomFolders: Array.isArray(genre.randomFolders) ? genre.randomFolders : [],
          openingFolders: Array.isArray(genre.openingFolders) ? genre.openingFolders : [],
        }))
      : [createDefaultGenre()]
  } catch {
    return [createDefaultGenre()]
  }
}

function persistGenres(genres: MusicScanGenre[]): void {
  localStorage.setItem(SCAN_CONFIG_STORAGE_KEY, JSON.stringify({ version: 1, genres }))
}

function createDefaultGenre(name = 'Mặc định'): MusicScanGenre {
  return {
    id: `genre-${Date.now()}-${scanGenreCounter++}`,
    name,
    priorityFolders: [],
    randomFolders: [],
    openingFolders: [],
  }
}

function splitFolderText(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function mergeFolders(current: string[], selected: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const folder of [...current, ...selected]) {
    const trimmed = folder.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

function normalizeWindowsFolder(folder: string): string | null {
  const normalized = folder.trim().replace(/\//g, '\\').replace(/\\+$/, '')
  if (!/^[a-z]:\\/i.test(normalized)) return null
  return normalized
}

function isInsideWindowsFolder(candidate: string, folder: string): boolean {
  const candidateKey = candidate.toLowerCase()
  const folderKey = folder.toLowerCase()
  return candidateKey === folderKey || candidateKey.startsWith(`${folderKey}\\`)
}

function getAutoNormalizeOutputFolder(genres: MusicScanGenre[], fallbackFile: string): string | null {
  const roots = genres
    .flatMap((genre) => [...genre.priorityFolders, ...genre.randomFolders, ...genre.openingFolders])
    .map(normalizeWindowsFolder)
    .filter((folder): folder is string => !!folder)

  const sourceRoots = roots.length > 0 ? roots : [normalizeWindowsFolder(fallbackFile.replace(/[\\/][^\\/]+$/, ''))].filter((folder): folder is string => !!folder)
  if (sourceRoots.length === 0) return null

  const segments = sourceRoots.map((folder) => folder.split('\\'))
  if (segments.some((parts) => parts[0]?.toLowerCase() !== segments[0][0]?.toLowerCase())) return null

  const common = [...segments[0]]
  while (common.length > 1 && segments.some((parts) => parts[common.length - 1]?.toLowerCase() !== common[common.length - 1]?.toLowerCase())) {
    common.pop()
  }

  const parent = common.length > 1 ? common.slice(0, -1).join('\\') : `${common[0]}\\`
  const candidate = `${parent.replace(/\\+$/, '')}\\aac_chuanhoa`
  return sourceRoots.some((folder) => isInsideWindowsFolder(candidate, folder)) ? null : candidate
}

function cleanupGenres(genres: MusicScanGenre[]): MusicScanGenre[] {
  return genres.map((genre, index) => ({
    id: genre.id || `genre-${index + 1}`,
    name: genre.name.trim() || `Thể loại ${index + 1}`,
    priorityFolders: mergeFolders([], genre.priorityFolders ?? []),
    randomFolders: mergeFolders([], genre.randomFolders ?? []),
    openingFolders: mergeFolders([], genre.openingFolders ?? []),
  })).filter((genre) => genre.priorityFolders.length > 0 || genre.randomFolders.length > 0 || genre.openingFolders.length > 0)
}

function genresFromResult(result: ScanMusicResult | null): MusicScanGenre[] {
  const genres = result?.config?.genres
  if (!Array.isArray(genres) || genres.length === 0) return [createDefaultGenre()]
  return genres.map((genre, index) => ({
    id: genre.id || `genre-${index + 1}`,
    name: genre.name || `Thể loại ${index + 1}`,
    priorityFolders: Array.isArray(genre.priorityFolders) ? genre.priorityFolders : [],
    randomFolders: Array.isArray(genre.randomFolders) ? genre.randomFolders : [],
    openingFolders: Array.isArray(genre.openingFolders) ? genre.openingFolders : [],
  }))
}

function ScanMusicPage() {
  console.log('[ScanMusicPage] Component mounted/rendered')

  const [genres, setGenres] = useState<MusicScanGenre[]>(() => loadSavedGenres())
  const [result, setResult] = useState<ScanMusicResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [configSavedAt, setConfigSavedAt] = useState<string | null>(null)
  // Normalize audio states
  const [normalizeMode, setNormalizeMode] = useState<'files' | 'folder'>('files')
  const [normalizeFiles, setNormalizeFiles] = useState<string[]>([])
  const [normalizeFolder, setNormalizeFolder] = useState<string | null>(null)
  const [outputFolder, setOutputFolder] = useState<string | null>(null)
  const [targetBitrate, setTargetBitrate] = useState<number>(384)
  const [outputFormat, setOutputFormat] = useState<'mp3' | 'aac' | 'keep'>('aac')
  const [backupOriginal, setBackupOriginal] = useState<boolean>(false)
  const [normalizeLoading, setNormalizeLoading] = useState(false)
  const [normalizeProgress, setNormalizeProgress] = useState<{
    currentFile: string
    currentIndex: number
    totalFiles: number
    percent: number
    status: 'processing' | 'completed' | 'error' | 'cancelled'
    etaSeconds?: number
    error?: string
  } | null>(null)
  const [normalizeResult, setNormalizeResult] = useState<{
    success: boolean
    processed: number
    failed: number
    errors: Array<{ file: string; error: string }>
    outputFiles: string[]
  } | null>(null)
  const [normalizeOpen, setNormalizeOpen] = useState(false)

  // Quick Non-AAC Detection & Normalize States
  const [nonAacDetailsOpen, setNonAacDetailsOpen] = useState(false)
  const [nonAacSearchQuery, setNonAacSearchQuery] = useState('')
  const [nonAacOutputMode, setNonAacOutputMode] = useState<'per_source_chuanhoa' | 'custom_folder' | 'same_folder'>('per_source_chuanhoa')
  const [nonAacCustomFolder, setNonAacCustomFolder] = useState<string>('')
  const [nonAacDeleteOriginal, setNonAacDeleteOriginal] = useState<boolean>(true)
  const [nonAacBitrate, setNonAacBitrate] = useState<number>(384)
  const [nonAacConverting, setNonAacConverting] = useState(false)
  const [nonAacConvertProgress, setNonAacConvertProgress] = useState<{
    currentFile: string
    currentIndex: number
    totalFiles: number
    percent: number
    status: 'processing' | 'completed' | 'error' | 'cancelled'
    etaSeconds?: number
    error?: string
  } | null>(null)
  const [nonAacConvertResult, setNonAacConvertResult] = useState<{
    success: boolean
    processed: number
    failed: number
    errors: Array<{ file: string; error: string }>
    outputFiles: string[]
    deletedOriginalFiles?: string[]
  } | null>(null)
  const [nonAacAppliedFolders, setNonAacAppliedFolders] = useState(false)
  const [copiedFilePath, setCopiedFilePath] = useState<string | null>(null)

  const nonAacTracks = useMemo(() => {
    if (!result?.tracks) return []
    return result.tracks.filter((t) => t.codec?.toLowerCase() !== 'aac')
  }, [result])

  const nonAacByFolder = useMemo(() => {
    const map = new Map<string, {
      folderPath: string
      folderType: 'priority' | 'random' | 'opening' | string
      genreName?: string
      tracks: typeof nonAacTracks
    }>()

    for (const track of nonAacTracks) {
      const folder = track.sourceFolder || (track.path.includes('\\')
        ? track.path.substring(0, track.path.lastIndexOf('\\'))
        : track.path.substring(0, track.path.lastIndexOf('/')))
      const key = folder.toLowerCase()
      const existing = map.get(key)
      if (existing) {
        existing.tracks.push(track)
      } else {
        map.set(key, {
          folderPath: folder,
          folderType: track.folderType || 'random',
          genreName: track.genreName,
          tracks: [track],
        })
      }
    }
    return Array.from(map.values())
  }, [nonAacTracks])

  const filteredNonAacTracks = useMemo(() => {
    const query = nonAacSearchQuery.trim().toLowerCase()
    if (!query) return nonAacTracks
    return nonAacTracks.filter(
      (t) => t.fileName.toLowerCase().includes(query) || t.path.toLowerCase().includes(query)
    )
  }, [nonAacTracks, nonAacSearchQuery])

  useEffect(() => {
    console.log('[ScanMusicPage] useEffect - component mounted')
    let disposed = false

    const hydrateSavedScan = async () => {
      const hasBackendCacheApi = typeof window.api.getLastScanResult === 'function'
      try {
        if (hasBackendCacheApi) {
          const saved = await window.api.getLastScanResult()
          if (!disposed && saved?.tracks?.length) {
            setResult(saved)
            if (!localStorage.getItem(SCAN_CONFIG_STORAGE_KEY)) {
              setGenres(genresFromResult(saved))
            }
            localStorage.setItem(SCAN_RESULT_STORAGE_KEY, JSON.stringify(saved))
            window.dispatchEvent(new CustomEvent('musicScanCompleted', { detail: saved }))
          }
          return
        }
      } catch (err) {
        console.warn('[ScanMusicPage] getLastScanResult failed:', err)
      }

      try {
        const raw = localStorage.getItem(SCAN_RESULT_STORAGE_KEY)
        if (!raw || disposed) return
        const parsed = JSON.parse(raw) as ScanMusicResult
        setResult(parsed)
        setGenres(genresFromResult(parsed))
      } catch (err) {
        console.warn('[ScanMusicPage] scanResultV1 parse failed:', err)
      }
    }

    hydrateSavedScan()

    return () => {
      disposed = true
      console.log('[ScanMusicPage] useEffect cleanup - component unmounted')
    }
  }, [])

  const handleAddGenre = () => {
    setGenres(prev => [...prev, createDefaultGenre(`Thể loại ${prev.length + 1}`)])
    setError(null)
  }

  const handleDuplicateGenre = (genre: MusicScanGenre) => {
    setGenres(prev => [...prev, {
      ...genre,
      id: `genre-${Date.now()}-${scanGenreCounter++}`,
      name: `${genre.name} (copy)`,
    }])
    setError(null)
  }

  const handleRemoveGenre = (id: string) => {
    setGenres(prev => prev.length <= 1 ? prev : prev.filter(genre => genre.id !== id))
    setResult(null)
    setError(null)
  }

  const handleUpdateGenre = (id: string, patch: Partial<MusicScanGenre>) => {
    setGenres(prev => prev.map(genre => genre.id === id ? { ...genre, ...patch } : genre))
    setResult(null)
    setError(null)
  }

  const handleSelectGenreFolders = async (id: string, field: 'priorityFolders' | 'randomFolders' | 'openingFolders') => {
    try {
      const dialogResult = await window.api.dialog?.openFile?.({
        title: 'Chọn thư mục nhạc',
        properties: ['openDirectory', 'multiSelections'],
      })
      const selected = dialogResult && !dialogResult.canceled ? dialogResult.filePaths : []
      if (!selected || selected.length === 0) return
      setGenres(prev => prev.map(genre => genre.id === id
        ? { ...genre, [field]: mergeFolders(genre[field], selected) }
        : genre))
      setResult(null)
      setError(null)
    } catch (err) {
      console.error('Failed to select folders:', err)
    }
  }

  const handleScan = async (forceRescan = false) => {
    const scanGenres = cleanupGenres(genres)
    if (scanGenres.length === 0) {
      setError('Vui lòng chọn ít nhất 1 thư mục.')
      return
    }

    setError(null)
    setLoading(true)
    setResult(null)

    try {
      const firstPriorityFolder = scanGenres.flatMap((genre) => genre.priorityFolders)[0] ?? null
      const firstRandomFolder = scanGenres.flatMap((genre) => genre.randomFolders)[0] ?? null
      // Multi-genre scan must go through new backend. Sending legacy folders to old main silently scans only genre 1.
      const payload = scanGenres.length === 1
        ? { genres: scanGenres, priorityFolder: firstPriorityFolder, randomFolder: firstRandomFolder, forceRescan }
        : { genres: scanGenres, forceRescan }
      const res = await window.api.scanMusicFolders(payload)
      if (scanGenres.length > 1 && (!res.config?.genres || res.config.genres.length < scanGenres.length)) {
        setError('Backend dev app chưa reload nên chỉ quét được 1 thể loại. Tắt/mở lại dev app rồi bấm Quét nhạc.')
        return
      }
      setResult(res)
      if (res.config?.genres?.length) setGenres(genresFromResult(res))
    } catch (e: any) {
      const message = e?.message || 'Có lỗi xảy ra khi quét nhạc.'
      setError(scanGenres.length > 1 && message.includes('No folders provided')
        ? 'Backend dev app chưa reload nên chưa nhận payload nhiều thể loại. Tắt/mở lại dev app rồi bấm Quét nhạc.'
        : message)
    } finally {
      setLoading(false)
    }
  }

  // Persist scan result separately from editable folder configuration.
  useEffect(() => {
    if (result) {
      localStorage.setItem(SCAN_RESULT_STORAGE_KEY, JSON.stringify(result))
      window.dispatchEvent(new CustomEvent('musicScanCompleted', { detail: result }))
    }
  }, [result])

  const handleSaveConfig = () => {
    try {
      const cleaned = cleanupGenres(genres)
      if (cleaned.length === 0) {
        setError('Vui lòng chọn ít nhất 1 thư mục trước khi lưu.')
        return
      }
      persistGenres(cleaned)
      setGenres(cleaned)
      setConfigSavedAt(new Date().toLocaleTimeString('vi-VN'))
      setError(null)
    } catch (saveError: any) {
      setError(`Không lưu được cấu hình thư mục: ${saveError?.message || 'Lỗi localStorage'}`)
    }
  }

  // Listen for normalize audio progress
  useEffect(() => {
    const unsubscribe = window.api.music.onNormalizeAudioProgress?.((progress: any) => {
      setNormalizeProgress(progress)
      setNonAacConvertProgress(progress)
      if (progress.status === 'completed' || progress.status === 'cancelled' || progress.status === 'error') {
        setNormalizeLoading(false)
        setNonAacConverting(false)
      }
    })
    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [])

  const handleSelectNormalizeFiles = async () => {
    try {
      const files = await window.api.selectAudioFilesMulti()
      if (files && files.length > 0) {
        setNormalizeFiles(files)
        setNormalizeResult(null)
      }
    } catch (err) {
      console.error('Failed to select audio files:', err)
    }
  }

  const handleSelectNormalizeFolder = async () => {
    try {
      const folder = await window.api.selectFolder()
      if (folder) {
        setNormalizeFolder(folder)
        setNormalizeResult(null)
      }
    } catch (err) {
      console.error('Failed to select folder:', err)
    }
  }

  const handleSelectOutputFolder = async () => {
    try {
      const folder = await window.api.selectFolder()
      if (folder) {
        setOutputFolder(folder)
        setNormalizeResult(null)
      }
    } catch (err) {
      console.error('Failed to select output folder:', err)
    }
  }

  /**
   * Tự động điền danh sách file non-AAC vào phần Chuẩn hóa.
   * Output folder nằm ngoài các folder đang scan để lần quét sau không thấy bản AAC như file mới.
   */
  const handleAutoFillNonAac = () => {
    if (!result?.nonAacFiles || result.nonAacFiles.length === 0) return

    const autoOutputFolder = getAutoNormalizeOutputFolder(genres, result.nonAacFiles[0])
    if (!autoOutputFolder) {
      setError('Không xác định được thư mục AAC riêng ngoài các folder đang quét. Hãy chọn Thư mục xuất thủ công.')
      return
    }

    setNormalizeMode('files')
    setNormalizeFiles(result.nonAacFiles)
    setOutputFolder(autoOutputFolder)
    setOutputFormat('aac')
    setNormalizeResult(null)

    setNormalizeOpen(true)
    setTimeout(() => {
      document.getElementById('normalize-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }

  const handleNormalizeAudio = async () => {
    if (normalizeMode === 'files' && normalizeFiles.length === 0) {
      setError('Vui lòng chọn ít nhất 1 file audio.')
      return
    }
    if (normalizeMode === 'folder' && !normalizeFolder) {
      setError('Vui lòng chọn folder.')
      return
    }

    setError(null)
    setNormalizeLoading(true)
    setNormalizeProgress(null)
    setNormalizeResult(null)

    try {
      const request: any = {
        targetBitrate,
        outputFormat,
        backupOriginal,
      }

      if (normalizeMode === 'files') {
        request.files = normalizeFiles
      } else {
        request.folder = normalizeFolder
      }

      if (outputFolder) {
        request.outputFolder = outputFolder
      }

      const result = await window.api.music.normalizeAudio(request)
      setNormalizeResult(result)
    } catch (e: any) {
      setError(e?.message || 'Có lỗi xảy ra khi chuẩn hóa âm thanh.')
      setNormalizeResult({
        success: false,
        processed: 0,
        failed: 0,
        errors: [{ file: '', error: e?.message || 'Unknown error' }],
        outputFiles: [],
      })
    } finally {
      setNormalizeLoading(false)
    }
  }

  const handleCancelNormalize = async () => {
    try {
      await window.api.music.cancelNormalizeAudio?.()
      setNormalizeLoading(false)
    } catch (err) {
      console.error('Cancel normalize error:', err)
      setNormalizeLoading(false)
    }
  }

  const handleCopyPath = (pathText: string) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(pathText)
      setCopiedFilePath(pathText)
      setTimeout(() => setCopiedFilePath(null), 1500)
    }
  }

  const handleSelectNonAacCustomFolder = async () => {
    try {
      const folder = await window.api.selectFolder()
      if (folder) {
        setNonAacCustomFolder(folder)
      }
    } catch (err) {
      console.error('Failed to select custom folder for non-AAC:', err)
    }
  }

  const handleStartNonAacNormalize = async () => {
    if (nonAacTracks.length === 0) return

    if (nonAacOutputMode === 'custom_folder' && !nonAacCustomFolder) {
      setError('Vui lòng chọn thư mục xuất trước khi bắt đầu chuẩn hóa.')
      return
    }

    setError(null)
    setNonAacConverting(true)
    setNonAacConvertProgress(null)
    setNonAacConvertResult(null)
    setNonAacAppliedFolders(false)

    try {
      const files = nonAacTracks.map((t) => t.path)
      const request: any = {
        files,
        targetBitrate: nonAacBitrate,
        outputFormat: 'aac',
        deleteOriginalOnSuccess: nonAacDeleteOriginal,
      }

      if (nonAacOutputMode === 'per_source_chuanhoa') {
        request.perSourceFolderSuffix = '_chuanhoa'
      } else if (nonAacOutputMode === 'custom_folder') {
        request.outputFolder = nonAacCustomFolder
      }

      const res = await window.api.music.normalizeAudio(request)
      setNonAacConvertResult(res)
    } catch (err: any) {
      setError(err?.message || 'Có lỗi xảy ra khi chuẩn hóa AAC.')
      setNonAacConvertResult({
        success: false,
        processed: 0,
        failed: nonAacTracks.length,
        errors: [{ file: '', error: err?.message || 'Lỗi không xác định' }],
        outputFiles: [],
      })
    } finally {
      setNonAacConverting(false)
    }
  }

  const handleCancelNonAacNormalize = async () => {
    try {
      await window.api.music.cancelNormalizeAudio?.()
      setNonAacConverting(false)
    } catch (err) {
      console.error('Cancel normalize error:', err)
      setNonAacConverting(false)
    }
  }

  const handleApplyChuanhoaFolders = async () => {
    if (nonAacByFolder.length === 0) return

    const sourceFoldersToReplace = new Map<string, string>()
    if (nonAacOutputMode === 'per_source_chuanhoa') {
      for (const grp of nonAacByFolder) {
        sourceFoldersToReplace.set(grp.folderPath.toLowerCase(), `${grp.folderPath}_chuanhoa`)
      }
    } else if (nonAacOutputMode === 'custom_folder' && nonAacCustomFolder) {
      for (const grp of nonAacByFolder) {
        sourceFoldersToReplace.set(grp.folderPath.toLowerCase(), nonAacCustomFolder)
      }
    }

    const replaceFolder = (f: string): string => {
      const match = sourceFoldersToReplace.get(f.toLowerCase())
      return match || f
    }

    const updatedGenres = genres.map((g) => ({
      ...g,
      priorityFolders: Array.from(new Set(g.priorityFolders.map(replaceFolder))),
      randomFolders: Array.from(new Set(g.randomFolders.map(replaceFolder))),
      openingFolders: Array.from(new Set(g.openingFolders.map(replaceFolder))),
    }))

    persistGenres(updatedGenres)
    setGenres(updatedGenres)
    setNonAacAppliedFolders(true)

    // Trigger auto-rescan
    try {
      setLoading(true)
      const firstPriorityFolder = updatedGenres.flatMap((g) => g.priorityFolders)[0] ?? null
      const firstRandomFolder = updatedGenres.flatMap((g) => g.randomFolders)[0] ?? null
      const payload = updatedGenres.length === 1
        ? { genres: updatedGenres, priorityFolder: firstPriorityFolder, randomFolder: firstRandomFolder, forceRescan: true }
        : { genres: updatedGenres, forceRescan: true }
      const res = await window.api.scanMusicFolders(payload)
      setResult(res)
    } catch (e: any) {
      setError(e?.message || 'Có lỗi xảy ra khi quét lại sau khi cập nhật thư mục.')
    } finally {
      setLoading(false)
    }
  }

  const handleOpenOutputFolder = async () => {
    try {
      let folderToOpen: string | null = null

      if (outputFolder) {
        folderToOpen = outputFolder
      } else if (normalizeResult && normalizeResult.outputFiles.length > 0) {
        const firstOutputFile = normalizeResult.outputFiles[0]
        const pathParts = firstOutputFile.split(/[/\\]/)
        pathParts.pop()
        folderToOpen = pathParts.join('\\')
      }

      if (!folderToOpen) {
        alert('Không tìm thấy thư mục xuất.')
        return
      }

      const result = await window.api.openPath(folderToOpen)
      if (!result.success && result.error) {
        alert(`Không thể mở thư mục: ${result.error}`)
      }
    } catch (err: any) {
      console.error('Open output folder error:', err)
      alert(err?.message || 'Không thể mở thư mục xuất.')
    }
  }

  const canScan = cleanupGenres(genres).length > 0

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: '28px', fontWeight: 'bold' }}>
            Quét nhạc
          </h1>
          <p style={{ color: '#9ca3af', fontSize: '14px', lineHeight: '1.5', margin: 0 }}>
            Chọn folder ưu tiên/random theo từng thể loại. Kết quả được lưu lại nếu file còn đúng đường dẫn.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={handleAddGenre}
            disabled={loading}
            style={{ padding: '9px 14px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}
          >
            + Thêm thể loại
          </button>
          <button
            onClick={handleSaveConfig}
            disabled={loading}
            style={{ padding: '10px 14px', backgroundColor: loading ? '#555' : '#374151', color: '#fff', border: '1px solid #4b5563', borderRadius: '6px', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 'bold' }}
          >
            Lưu cấu hình
          </button>
          {configSavedAt && <span style={{ color: '#86efac', fontSize: '12px' }}>Đã lưu {configSavedAt}</span>}
          <button
            onClick={() => handleScan(false)}
            disabled={loading || !canScan}
            style={{
              padding: '10px 20px',
              backgroundColor: loading || !canScan ? '#555' : '#007acc',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: loading || !canScan ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: 'bold',
            }}
          >
            {loading ? 'Đang quét...' : 'Quét nhạc'}
          </button>
          {result && (
            <button
              onClick={() => handleScan(true)}
              disabled={loading || !canScan}
              style={{ padding: '10px 14px', backgroundColor: '#1f2937', color: '#e5e7eb', border: '1px solid #4b5563', borderRadius: '6px', cursor: loading || !canScan ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 'bold' }}
            >
              Quét lại từ đầu
            </button>
          )}
        </div>
      </div>

      {loading && (
        <p style={{ margin: '0 0 12px', color: '#888', fontSize: '13px' }}>
          Đang quét... có thể mất vài phút nếu thư viện lớn.
        </p>
      )}

      <div style={{ marginBottom: '18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {genres.map((genre, index) => (
          <div key={genre.id} style={{ padding: '12px', backgroundColor: '#252526', borderRadius: '8px', border: '1px solid #333' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px' }}>
              <strong style={{ fontSize: '14px', minWidth: '70px' }}>{index + 1}.</strong>
              <input
                value={genre.name}
                onChange={(e) => handleUpdateGenre(genre.id, { name: e.target.value })}
                disabled={loading}
                placeholder="VD: Tomorrowland, Lofi, Party Mix..."
                style={{ flex: 1, padding: '7px 10px', backgroundColor: '#1e1e1e', color: '#fff', border: '1px solid #444', borderRadius: '4px' }}
              />
              <button
                onClick={() => handleDuplicateGenre(genre)}
                disabled={loading}
                style={{ padding: '7px 10px', backgroundColor: '#333', color: '#ddd', border: '1px solid #555', borderRadius: '4px', cursor: loading ? 'not-allowed' : 'pointer' }}
              >
                Nhân bản
              </button>
              <button
                onClick={() => handleRemoveGenre(genre.id)}
                disabled={loading || genres.length <= 1}
                style={{ padding: '7px 10px', backgroundColor: '#3a1f1f', color: '#ff8888', border: '1px solid #662222', borderRadius: '4px', cursor: loading || genres.length <= 1 ? 'not-allowed' : 'pointer' }}
              >
                Xóa
              </button>
            </div>

            {([
              ['priorityFolders', 'Nhạc ưu tiên'],
              ['randomFolders', 'Nhạc random'],
              ['openingFolders', 'Nhạc mở đầu'],
            ] as const).map(([field, label]) => (
              <div key={field} style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr) auto auto', gap: '8px', alignItems: 'start', marginBottom: '8px' }}>
                <label style={{ color: '#9ca3af', fontSize: '12px', paddingTop: '8px' }}>{label}</label>
                <textarea
                  value={genre[field].join('\n')}
                  onChange={(e) => handleUpdateGenre(genre.id, { [field]: splitFolderText(e.target.value) } as any)}
                  disabled={loading}
                  placeholder="Dán mỗi folder một dòng"
                  rows={Math.min(4, Math.max(1, genre[field].length || 1))}
                  title={genre[field].join('\n')}
                  style={{ minHeight: '34px', padding: '7px 9px', backgroundColor: '#1e1e1e', color: '#fff', border: '1px solid #444', borderRadius: '4px', resize: 'vertical', fontFamily: 'monospace', fontSize: '12px', lineHeight: 1.4 }}
                />
                <button
                  onClick={() => handleSelectGenreFolders(genre.id, field)}
                  disabled={loading}
                  style={{ padding: '8px 12px', backgroundColor: '#007acc', color: '#fff', border: 'none', borderRadius: '4px', cursor: loading ? 'not-allowed' : 'pointer' }}
                >
                  Chọn
                </button>
                <button
                  onClick={() => handleUpdateGenre(genre.id, { [field]: [] } as any)}
                  disabled={loading || genre[field].length === 0}
                  style={{ padding: '8px 10px', backgroundColor: '#3a1f1f', color: '#ff8888', border: '1px solid #662222', borderRadius: '4px', cursor: loading || genre[field].length === 0 ? 'not-allowed' : 'pointer' }}
                >
                  Xóa
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Non-AAC Detection & Management Panel — hiển thị khi scan xong và có file chưa chuẩn AAC hoặc đang/vừa chuẩn hóa */}
      {((result && result.nonAacFiles && result.nonAacFiles.length > 0) || nonAacConverting || (nonAacConvertResult && nonAacConvertResult.processed > 0)) && (
        <div
          style={{
            margin: '20px 0',
            padding: '20px',
            backgroundColor: '#1e1a14',
            border: '1px solid #d97706',
            borderRadius: '8px',
          }}
        >
          {/* Header */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#f59e0b', marginBottom: '6px' }}>
              Phát hiện {nonAacTracks.length} file âm thanh chưa phải chuẩn AAC
            </div>
            <div style={{ fontSize: '13px', color: '#d1d5db', lineHeight: '1.5' }}>
              Các file định dạng .mp3, .wav, .flac... làm giảm tốc độ ghép nhạc do ffmpeg phải giải mã lại. Chuẩn hóa sang AAC (.m4a) giúp hệ thống xuất playlist bằng cơ chế stream copy nhanh gấp nhiều lần và đồng nhất âm lượng.
            </div>
          </div>

          {/* Grouped by source folders */}
          {nonAacByFolder.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#f3f4f6', marginBottom: '8px' }}>
                Danh sách thư mục nguồn chứa file chưa chuẩn hóa ({nonAacByFolder.length} thư mục):
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {nonAacByFolder.map((grp) => (
                  <div
                    key={grp.folderPath}
                    style={{
                      backgroundColor: '#282319',
                      border: '1px solid #4a3b22',
                      borderRadius: '6px',
                      padding: '10px 14px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', flexWrap: 'wrap', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 'bold',
                            backgroundColor: '#1f1a14',
                            color: getFolderTypeLabel(grp.folderType).color,
                            border: `1px solid ${getFolderTypeLabel(grp.folderType).color}40`,
                          }}
                        >
                          {getFolderTypeLabel(grp.folderType).label}
                        </span>
                        {grp.genreName && (
                          <span style={{ fontSize: '12px', color: '#9ca3af' }}>
                            Thể loại: <strong style={{ color: '#ffffff' }}>{grp.genreName}</strong>
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '12px', color: '#f59e0b', fontWeight: 'bold' }}>
                        {grp.tracks.length} file chưa chuẩn AAC
                      </div>
                    </div>
                    <div style={{ fontSize: '13px', color: '#ffffff', fontFamily: 'monospace', wordBreak: 'break-all', marginBottom: '4px' }}>
                      {grp.folderPath}
                    </div>
                    {nonAacOutputMode === 'per_source_chuanhoa' && (
                      <div style={{ fontSize: '12px', color: '#86efac' }}>
                        Thư mục đích chuẩn hóa: <span style={{ fontFamily: 'monospace' }}>{grp.folderPath}_chuanhoa</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Toggleable Detailed File List */}
          {nonAacTracks.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <button
                type="button"
                onClick={() => setNonAacDetailsOpen((prev) => !prev)}
                style={{
                  padding: '6px 14px',
                  backgroundColor: '#262626',
                  color: '#e5e7eb',
                  border: '1px solid #404040',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 500,
                }}
              >
                {nonAacDetailsOpen
                  ? 'Ẩn danh sách file chi tiết'
                  : `Xem danh sách chi tiết tất cả file (${nonAacTracks.length} file)`}
              </button>

              {nonAacDetailsOpen && (
                <div style={{ marginTop: '10px', backgroundColor: '#141414', border: '1px solid #333', borderRadius: '6px', padding: '12px' }}>
                  <input
                    type="text"
                    placeholder="Lọc theo tên file hoặc đường dẫn..."
                    value={nonAacSearchQuery}
                    onChange={(e) => setNonAacSearchQuery(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 12px',
                      backgroundColor: '#1f1f1f',
                      border: '1px solid #444',
                      borderRadius: '4px',
                      color: '#ffffff',
                      fontSize: '13px',
                      marginBottom: '10px',
                    }}
                  />
                  <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '8px' }}>
                    Hiển thị {filteredNonAacTracks.length} / {nonAacTracks.length} file
                  </div>
                  <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #333', textAlign: 'left', color: '#9ca3af' }}>
                          <th style={{ padding: '6px 8px' }}>Tên file</th>
                          <th style={{ padding: '6px 8px' }}>Loại</th>
                          <th style={{ padding: '6px 8px' }}>Codec</th>
                          <th style={{ padding: '6px 8px' }}>Thời lượng</th>
                          <th style={{ padding: '6px 8px' }}>Đường dẫn đầy đủ</th>
                          <th style={{ padding: '6px 8px', textAlign: 'center' }}>Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredNonAacTracks.map((track) => (
                          <tr key={track.id || track.path} style={{ borderBottom: '1px solid #222' }}>
                            <td style={{ padding: '6px 8px', color: '#ffffff', fontWeight: 500, wordBreak: 'break-all' }}>
                              {track.fileName}
                            </td>
                            <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                              <span style={{ color: getFolderTypeLabel(track.folderType).color }}>
                                {getFolderTypeLabel(track.folderType).label}
                              </span>
                            </td>
                            <td style={{ padding: '6px 8px', color: '#f59e0b', whiteSpace: 'nowrap' }}>
                              {track.codec || 'unknown'}
                            </td>
                            <td style={{ padding: '6px 8px', color: '#9ca3af', whiteSpace: 'nowrap' }}>
                              {formatDuration(track.duration)}
                            </td>
                            <td style={{ padding: '6px 8px', color: '#6b7280', fontFamily: 'monospace', fontSize: '11px', wordBreak: 'break-all' }}>
                              {track.path}
                            </td>
                            <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                              <button
                                type="button"
                                onClick={() => handleCopyPath(track.path)}
                                style={{
                                  padding: '3px 8px',
                                  backgroundColor: copiedFilePath === track.path ? '#15803d' : '#333333',
                                  color: '#ffffff',
                                  border: 'none',
                                  borderRadius: '3px',
                                  cursor: 'pointer',
                                  fontSize: '11px',
                                }}
                              >
                                {copiedFilePath === track.path ? 'Đã chép' : 'Sao chép'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Destination options & processing configuration */}
          <div style={{ paddingTop: '14px', borderTop: '1px solid #4a3b22' }}>
            <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#f59e0b', marginBottom: '10px' }}>
              Cấu hình thư mục xuất và xử lý:
            </div>

            {/* Radio output mode */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="nonAacOutputMode"
                  checked={nonAacOutputMode === 'per_source_chuanhoa'}
                  onChange={() => setNonAacOutputMode('per_source_chuanhoa')}
                  style={{ marginTop: '3px' }}
                />
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#ffffff' }}>
                    Tự động tạo folder riêng thêm đuôi _chuanhoa vào sau từng folder nguồn (Khuyên dùng)
                  </div>
                  <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>
                    Các bài từ thư mục nào sẽ được xuất sang thư mục tương ứng có thêm hậu tố "_chuanhoa". Ví dụ: "E:\...\hardtechno da fix_chuanhoa".
                  </div>
                </div>
              </label>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="nonAacOutputMode"
                  checked={nonAacOutputMode === 'custom_folder'}
                  onChange={() => setNonAacOutputMode('custom_folder')}
                  style={{ marginTop: '3px' }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#ffffff' }}>
                    Xuất toàn bộ vào một thư mục được chỉ định
                  </div>
                  <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px', marginBottom: '6px' }}>
                    Tất cả các bài chưa chuẩn hóa sẽ được xuất sang một thư mục chung do bạn chọn.
                  </div>
                  {nonAacOutputMode === 'custom_folder' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                      <input
                        type="text"
                        readOnly
                        value={nonAacCustomFolder}
                        placeholder="Chưa chọn thư mục xuất..."
                        style={{
                          flex: 1,
                          padding: '6px 10px',
                          backgroundColor: '#141414',
                          border: '1px solid #444',
                          borderRadius: '4px',
                          color: '#ffffff',
                          fontSize: '12px',
                          fontFamily: 'monospace',
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleSelectNonAacCustomFolder}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: '#374151',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Chọn thư mục khác
                      </button>
                    </div>
                  )}
                </div>
              </label>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="nonAacOutputMode"
                  checked={nonAacOutputMode === 'same_folder'}
                  onChange={() => setNonAacOutputMode('same_folder')}
                  style={{ marginTop: '3px' }}
                />
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#ffffff' }}>
                    Lưu cùng thư mục với file gốc
                  </div>
                  <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>
                    Lưu trực tiếp file .m4a vào cùng thư mục với file gốc (.wav, .mp3).
                  </div>
                </div>
              </label>
            </div>

            {/* Checkbox auto-delete original & Bitrate */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '14px',
                marginBottom: '16px',
                padding: '10px 14px',
                backgroundColor: '#141414',
                borderRadius: '6px',
                border: '1px solid #333',
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={nonAacDeleteOriginal}
                  onChange={(e) => setNonAacDeleteOriginal(e.target.checked)}
                />
                <div>
                  <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#ffffff' }}>
                    Tự động xóa các bài chưa được chuẩn hóa sau khi xuất thành công
                  </span>
                  <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
                    Chỉ xóa an toàn file gốc sau khi đã xác nhận file .m4a mới tạo thành công và có dung lượng hợp lệ (lớn hơn 0 bytes).
                  </div>
                </div>
              </label>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: '#9ca3af' }}>Bitrate:</span>
                <select
                  value={nonAacBitrate}
                  onChange={(e) => setNonAacBitrate(Number(e.target.value))}
                  style={{
                    padding: '4px 8px',
                    backgroundColor: '#262626',
                    color: '#ffffff',
                    border: '1px solid #444',
                    borderRadius: '4px',
                    fontSize: '12px',
                  }}
                >
                  <option value={384}>384 kbps (Chuẩn YouTube chất lượng cao)</option>
                  <option value={320}>320 kbps (Chất lượng rất cao)</option>
                  <option value={256}>256 kbps (Tiêu chuẩn)</option>
                  <option value={192}>192 kbps (Tiết kiệm dung lượng)</option>
                </select>
              </div>
            </div>

            {/* Progress bar if converting */}
            {nonAacConverting && (
              <div style={{ marginBottom: '14px', padding: '12px', backgroundColor: '#141414', borderRadius: '6px', border: '1px solid #f59e0b40' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#ffffff', marginBottom: '6px' }}>
                  <span>
                    Đang chuẩn hóa: {nonAacConvertProgress?.currentIndex ?? 0} / {nonAacConvertProgress?.totalFiles ?? nonAacTracks.length} file ({nonAacConvertProgress?.percent ?? 0}%)
                  </span>
                  {typeof nonAacConvertProgress?.etaSeconds === 'number' && (
                    <span style={{ color: '#9ca3af' }}>
                      Ước tính còn: {nonAacConvertProgress.etaSeconds} giây
                    </span>
                  )}
                </div>
                <div style={{ height: '8px', backgroundColor: '#333', borderRadius: '4px', overflow: 'hidden', marginBottom: '6px' }}>
                  <div
                    style={{
                      height: '100%',
                      backgroundColor: '#f59e0b',
                      width: `${nonAacConvertProgress?.percent ?? 0}%`,
                      transition: 'width 0.2s',
                    }}
                  />
                </div>
                {nonAacConvertProgress?.currentFile && (
                  <div style={{ fontSize: '11px', color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Đang xử lý: {nonAacConvertProgress.currentFile}
                  </div>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              {nonAacConverting ? (
                <button
                  type="button"
                  onClick={handleCancelNonAacNormalize}
                  style={{
                    padding: '9px 18px',
                    backgroundColor: '#dc2626',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 'bold',
                  }}
                >
                  Dừng chuẩn hóa
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStartNonAacNormalize}
                  disabled={nonAacTracks.length === 0}
                  style={{
                    padding: '9px 20px',
                    backgroundColor: nonAacTracks.length === 0 ? '#4b5563' : '#f59e0b',
                    color: '#1a1000',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: nonAacTracks.length === 0 ? 'not-allowed' : 'pointer',
                    fontSize: '13px',
                    fontWeight: 'bold',
                  }}
                >
                  Bắt đầu xuất &amp; chuẩn hóa AAC ({nonAacTracks.length} file)
                </button>
              )}
            </div>

            {/* Result message & folder update action */}
            {nonAacConvertResult && (
              <div
                style={{
                  marginTop: '14px',
                  padding: '12px 16px',
                  backgroundColor: nonAacConvertResult.success ? '#0f2918' : '#2d1515',
                  border: `1px solid ${nonAacConvertResult.success ? '#16a34a' : '#ef4444'}`,
                  borderRadius: '6px',
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 'bold', color: nonAacConvertResult.success ? '#4ade80' : '#f87171', marginBottom: '4px' }}>
                  {nonAacConvertResult.success
                    ? `Chuẩn hóa hoàn tất thành công ${nonAacConvertResult.processed} / ${nonAacTracks.length} file.`
                    : `Chuẩn hóa kết thúc: ${nonAacConvertResult.processed} thành công, ${nonAacConvertResult.failed} thất bại.`}
                </div>

                {nonAacConvertResult.deletedOriginalFiles && nonAacConvertResult.deletedOriginalFiles.length > 0 && (
                  <div style={{ fontSize: '12px', color: '#86efac', marginBottom: '6px' }}>
                    Đã xóa an toàn {nonAacConvertResult.deletedOriginalFiles.length} file gốc chưa chuẩn hóa trên ổ đĩa.
                  </div>
                )}

                {nonAacConvertResult.errors.length > 0 && (
                  <div style={{ fontSize: '12px', color: '#fca5a5', marginTop: '4px' }}>
                    Lỗi: {nonAacConvertResult.errors.map((e) => `${e.file}: ${e.error}`).slice(0, 3).join('; ')}
                  </div>
                )}

                {nonAacConvertResult.success && nonAacConvertResult.processed > 0 && (
                  <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #1e3a24' }}>
                    {nonAacAppliedFolders ? (
                      <div style={{ fontSize: '13px', color: '#4ade80', fontWeight: 'bold' }}>
                        Đã cập nhật cấu hình thư mục sang các folder _chuanhoa và quét lại thành công!
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={handleApplyChuanhoaFolders}
                        style={{
                          padding: '8px 16px',
                          backgroundColor: '#16a34a',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '13px',
                          fontWeight: 'bold',
                        }}
                      >
                        Cập nhật cấu hình thư mục sang các folder _chuanhoa và quét lại ngay
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Normalize Audio Section */}
      <details
        id="normalize-section"
        open={normalizeOpen}
        onToggle={(e) => setNormalizeOpen(e.currentTarget.open)}
        style={{
          marginTop: '18px',
          padding: '0',
          backgroundColor: '#1e1e1e',
          borderRadius: '8px',
          border: '1px solid #333',
          overflow: 'hidden',
        }}
      >
        <summary style={{ padding: '14px 16px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold', color: '#e5e7eb', backgroundColor: '#252526' }}>
          Công cụ phụ: Chuẩn hóa bitrate âm thanh
          <span style={{ marginLeft: '10px', color: '#9ca3af', fontSize: '12px', fontWeight: 400 }}>
            Mở khi cần đổi MP3/WAV/FLAC sang AAC.
          </span>
        </summary>
        <div style={{ padding: '18px' }}>
        <p style={{ color: '#888', fontSize: '14px', margin: '0 0 20px' }}>
          Chuẩn hóa bitrate của các file audio về cùng một giá trị để đảm bảo chất lượng đồng đều.
        </p>

        {/* Mode selection */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '10px', fontSize: '14px', fontWeight: 'bold' }}>
            Chọn chế độ:
          </label>
          <div style={{ display: 'flex', gap: '15px' }}>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="radio"
                checked={normalizeMode === 'files'}
                onChange={() => {
                  setNormalizeMode('files')
                  setNormalizeResult(null)
                }}
                style={{ marginRight: '8px' }}
              />
              Chọn file cụ thể
            </label>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="radio"
                checked={normalizeMode === 'folder'}
                onChange={() => {
                  setNormalizeMode('folder')
                  setNormalizeResult(null)
                }}
                style={{ marginRight: '8px' }}
              />
              Chọn folder (chuẩn hóa tất cả file trong folder)
            </label>
          </div>
        </div>

        {/* File/Folder selection */}
        {normalizeMode === 'files' ? (
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '10px', fontSize: '14px', fontWeight: 'bold' }}>
              File đã chọn:
            </label>
            <div style={{ marginBottom: '10px', color: '#ccc', fontSize: '14px' }}>
              {normalizeFiles.length > 0 ? (
                <div>
                  {normalizeFiles.length} file đã chọn
                  <div style={{ marginTop: '5px', maxHeight: '100px', overflowY: 'auto', fontSize: '12px' }}>
                    {normalizeFiles.slice(0, 5).map((f, i) => (
                      <div key={i} style={{ color: '#888' }}>
                        {f.split(/[/\\]/).pop()}
                      </div>
                    ))}
                    {normalizeFiles.length > 5 && (
                      <div style={{ color: '#888' }}>... và {normalizeFiles.length - 5} file khác</div>
                    )}
                  </div>
                </div>
              ) : (
                'Chưa chọn file'
              )}
            </div>
            <button
              onClick={handleSelectNormalizeFiles}
              disabled={normalizeLoading}
              style={{
                padding: '8px 16px',
                backgroundColor: '#007acc',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: normalizeLoading ? 'not-allowed' : 'pointer',
                fontSize: '14px',
              }}
            >
              Chọn file audio
            </button>
          </div>
        ) : (
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '10px', fontSize: '14px', fontWeight: 'bold' }}>
              Folder đã chọn:
            </label>
            <div style={{ marginBottom: '10px', color: '#ccc', fontSize: '14px' }}>
              {normalizeFolder || 'Chưa chọn'}
            </div>
            <button
              onClick={handleSelectNormalizeFolder}
              disabled={normalizeLoading}
              style={{
                padding: '8px 16px',
                backgroundColor: '#007acc',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: normalizeLoading ? 'not-allowed' : 'pointer',
                fontSize: '14px',
              }}
            >
              Chọn folder
            </button>
          </div>
        )}

        {/* Settings */}
        <div style={{ marginBottom: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 'bold' }}>
              Bitrate mục tiêu (kbps) – gợi ý YouTube: Stereo 384 kbps:
            </label>
            <select
              value={targetBitrate}
              onChange={(e) => setTargetBitrate(Number(e.target.value))}
              disabled={normalizeLoading}
              style={{
                width: '100%',
                padding: '8px',
                backgroundColor: '#252526',
                color: '#fff',
                border: '1px solid #444',
                borderRadius: '4px',
                fontSize: '14px',
              }}
            >
              <option value={128}>128 kbps</option>
              <option value={192}>192 kbps</option>
              <option value={256}>256 kbps</option>
              <option value={320}>320 kbps</option>
              <option value={384}>384 kbps (khuyến nghị YouTube cho stereo)</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 'bold' }}>
              Format output:
            </label>
            <select
              value={outputFormat}
              onChange={(e) => setOutputFormat(e.target.value as 'mp3' | 'aac' | 'keep')}
              disabled={normalizeLoading}
              style={{
                width: '100%',
                padding: '8px',
                backgroundColor: '#252526',
                color: '#fff',
                border: '1px solid #444',
                borderRadius: '4px',
                fontSize: '14px',
              }}
            >
              <option value="keep">Giữ nguyên format gốc</option>
              <option value="mp3">MP3</option>
              <option value="aac">AAC</option>
            </select>
          </div>
        </div>

        {/* Output folder */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 'bold' }}>
            Thư mục xuất (tùy chọn):
          </label>
          <div style={{ marginBottom: '10px', color: '#ccc', fontSize: '14px' }}>
            {outputFolder || 'Không chọn (lưu cùng thư mục với file gốc)'}
          </div>
          <button
            onClick={handleSelectOutputFolder}
            disabled={normalizeLoading}
            style={{
              padding: '8px 16px',
              backgroundColor: '#28a745',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: normalizeLoading ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              marginRight: '10px',
            }}
          >
            Chọn thư mục xuất
          </button>
          {outputFolder && (
            <button
              onClick={() => {
                setOutputFolder(null)
                setNormalizeResult(null)
              }}
              disabled={normalizeLoading}
              style={{
                padding: '8px 16px',
                backgroundColor: '#dc3545',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: normalizeLoading ? 'not-allowed' : 'pointer',
                fontSize: '14px',
              }}
            >
              Xóa
            </button>
          )}
        </div>

        {/* Backup option */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={backupOriginal}
              onChange={(e) => setBackupOriginal(e.target.checked)}
              disabled={normalizeLoading}
              style={{ marginRight: '8px' }}
            />
            <span style={{ fontSize: '14px' }}>Backup file gốc (thêm _original vào tên file)</span>
          </label>
        </div>

        {/* Start button */}
            <div style={{ marginBottom: '20px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button
                onClick={handleNormalizeAudio}
                disabled={
                  normalizeLoading ||
                  (normalizeMode === 'files' && normalizeFiles.length === 0) ||
                  (normalizeMode === 'folder' && !normalizeFolder)
                }
                style={{
                  padding: '12px 24px',
                  backgroundColor: normalizeLoading ? '#555' : '#28a745',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor:
                    normalizeLoading ||
                    (normalizeMode === 'files' && normalizeFiles.length === 0) ||
                    (normalizeMode === 'folder' && !normalizeFolder)
                      ? 'not-allowed'
                      : 'pointer',
                  fontSize: '16px',
                  fontWeight: 'bold',
                }}
              >
                {normalizeLoading ? 'Đang chuẩn hóa...' : 'Bắt đầu chuẩn hóa'}
              </button>

              <button
                onClick={handleCancelNormalize}
                disabled={!normalizeLoading}
                style={{
                  padding: '12px 20px',
                  backgroundColor: !normalizeLoading ? '#444' : '#c53030',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: !normalizeLoading ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  fontWeight: 600,
                }}
              >
                Dừng
              </button>
            </div>

        {/* Progress */}
        {normalizeProgress && (
          <div
            style={{
              padding: '15px',
              backgroundColor: '#252526',
              borderRadius: '6px',
              marginBottom: '20px',
            }}
          >
            <div style={{ marginBottom: '10px', fontSize: '14px', fontWeight: 'bold' }}>
              Tiến trình: {normalizeProgress.currentIndex} / {normalizeProgress.totalFiles}{' '}
              {normalizeProgress.status === 'cancelled' && <span style={{ color: '#ffcc00' }}>(Đã dừng)</span>}
            </div>
            <div style={{ marginBottom: '10px', fontSize: '12px', color: '#888' }}>
              Đang xử lý: {normalizeProgress.currentFile || 'N/A'}
            </div>
            {typeof normalizeProgress.etaSeconds === 'number' && normalizeProgress.status === 'processing' && (
              <div style={{ marginBottom: '10px', fontSize: '12px', color: '#888' }}>
                Ước tính còn lại: {formatDurationShort(normalizeProgress.etaSeconds)}
              </div>
            )}
            <div
              style={{
                width: '100%',
                height: '20px',
                backgroundColor: '#1a1a1a',
                borderRadius: '4px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${normalizeProgress.percent}%`,
                  height: '100%',
                  backgroundColor: '#28a745',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <div style={{ marginTop: '5px', fontSize: '12px', color: '#888', textAlign: 'right' }}>
              {normalizeProgress.percent}%
            </div>
            {normalizeProgress.error && (
              <div style={{ marginTop: '8px', fontSize: '12px', color: '#ff8888' }}>
                {normalizeProgress.error}
              </div>
            )}
          </div>
        )}

        {/* Result */}
        {normalizeResult && (
          <div
            style={{
              padding: '15px',
              backgroundColor: normalizeResult.success ? '#1a3a1a' : '#3a1f1f',
              border: `1px solid ${normalizeResult.success ? '#28a745' : '#ff4444'}`,
              borderRadius: '6px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 'bold', margin: 0 }}>
                {normalizeResult.success ? 'Hoàn thành' : 'Có lỗi xảy ra'}
              </h3>
              {(normalizeResult.outputFiles.length > 0 || outputFolder) && (
                <button
                  onClick={handleOpenOutputFolder}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#007acc',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 500,
                  }}
                >
                  Mở thư mục xuất
                </button>
              )}
            </div>
            <div style={{ fontSize: '14px' }}>
              <div>Đã xử lý: {normalizeResult.processed} file</div>
              <div>Thất bại: {normalizeResult.failed} file</div>
              {normalizeResult.errors.length > 0 && (
                <div style={{ marginTop: '10px' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>Lỗi:</div>
                  <div style={{ maxHeight: '150px', overflowY: 'auto', fontSize: '12px' }}>
                    {normalizeResult.errors.map((err, i) => (
                      <div key={i} style={{ marginBottom: '5px', color: '#ff8888' }}>
                        {err.file.split(/[/\\]/).pop()}: {err.error}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {normalizeResult.outputFiles.length > 0 && (
                <div style={{ marginTop: '10px' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>
                    File đã tạo ({normalizeResult.outputFiles.length}):
                  </div>
                  <div style={{ maxHeight: '150px', overflowY: 'auto', fontSize: '12px', color: '#888' }}>
                    {normalizeResult.outputFiles.slice(0, 10).map((f, i) => (
                      <div key={i}>{f.split(/[/\\]/).pop()}</div>
                    ))}
                    {normalizeResult.outputFiles.length > 10 && (
                      <div>... và {normalizeResult.outputFiles.length - 10} file khác</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        </div>
      </details>

      {/* Error display */}
      {error && (
        <div
          style={{
            padding: '15px',
            backgroundColor: '#3a1f1f',
            border: '1px solid #ff4444',
            borderRadius: '6px',
            color: '#ff8888',
            marginBottom: '20px',
          }}
        >
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div>
          <h2 style={{ marginBottom: '20px', fontSize: '24px', fontWeight: 'bold' }}>
            Kết quả quét nhạc
          </h2>
          {(result.cacheStatus === 'reused' || result.cacheStatus === 'loaded') && (
            <div style={{ marginBottom: '16px', padding: '12px 14px', backgroundColor: '#1f2937', border: '1px solid #4b5563', borderRadius: '6px', color: '#cbd5e1', fontSize: '13px' }}>
              Đang dùng dữ liệu quét đã lưu. Nếu vừa thêm/xóa/sửa file, bấm <strong>Quét lại từ đầu</strong>.
            </div>
          )}

          {/* Summary */}
          <div
            style={{
              padding: '16px',
              backgroundColor: '#252526',
              borderRadius: '8px',
              marginBottom: '18px',
            }}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: '18px', fontWeight: 'bold' }}>
              Tóm tắt
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
              {[
                ['Tổng', result.summary.totalCount, result.summary.totalDuration, '#93c5fd'],
                ['Mở đầu', result.summary.openingCount ?? 0, result.summary.openingDuration ?? 0, '#38bdf8'],
                ['Ưu tiên', result.summary.priorityCount, result.summary.priorityDuration, '#fbbf24'],
                ['Random', result.summary.randomCount, result.summary.randomDuration, '#a78bfa'],
              ].map(([label, count, duration, color]) => (
                <div key={label as string} style={{ padding: '12px', backgroundColor: '#1e1e1e', borderRadius: '6px', border: '1px solid #333' }}>
                  <div style={{ color: '#9ca3af', fontSize: '12px', marginBottom: '4px' }}>{label}</div>
                  <div style={{ color: color as string, fontSize: '22px', fontWeight: 'bold', lineHeight: 1.2 }}>{count as number} bài</div>
                  <div style={{ color: '#cbd5e1', fontSize: '13px', marginTop: '3px' }}>{formatDuration(duration as number)}</div>
                </div>
              ))}
            </div>
            {result.summary.genres && result.summary.genres.length > 0 && (
              <div style={{ marginTop: '14px' }}>
                <div style={{ color: '#888', fontSize: '13px', marginBottom: '8px' }}>Theo thể loại</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                  {result.summary.genres.map((genre) => (
                    <div key={genre.genreId} style={{ padding: '10px', backgroundColor: '#1e1e1e', borderRadius: '4px', border: '1px solid #333' }}>
                      <div style={{ color: '#fff', fontWeight: 'bold', marginBottom: '4px' }}>{genre.genreName}</div>
                      <div style={{ color: '#ccc', fontSize: '13px' }}>{genre.totalCount} bài • {formatDuration(genre.totalDuration)}</div>
                      <div style={{ color: '#888', fontSize: '12px' }}>Ưu tiên {genre.priorityCount} · Random {genre.randomCount}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Track list (first 10) */}
          {result.tracks.length > 0 && (
            <details style={{ backgroundColor: '#252526', borderRadius: '8px', border: '1px solid #333', overflow: 'hidden' }}>
              <summary style={{ padding: '12px 14px', cursor: 'pointer', fontSize: '15px', fontWeight: 'bold' }}>
                Danh sách bài hát — {Math.min(result.tracks.length, 10)} / {result.tracks.length} bài đầu tiên
              </summary>
              <div
                style={{
                  overflowX: 'auto',
                  padding: '10px',
                }}
              >
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #444' }}>
                      <th style={{ padding: '10px', textAlign: 'left', color: '#888' }}>#</th>
                      <th style={{ padding: '10px', textAlign: 'left', color: '#888' }}>
                        Tên bài
                      </th>
                      <th style={{ padding: '10px', textAlign: 'left', color: '#888' }}>Loại</th>
                      <th style={{ padding: '10px', textAlign: 'left', color: '#888' }}>Thể loại</th>
                      <th style={{ padding: '10px', textAlign: 'left', color: '#888' }}>
                        Thời lượng
                      </th>
                      <th style={{ padding: '10px', textAlign: 'left', color: '#888' }}>Codec</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.tracks.slice(0, 10).map((track, index) => (
                      <tr key={track.id} style={{ borderBottom: '1px solid #333' }}>
                        <td style={{ padding: '10px', color: '#ccc' }}>{index + 1}</td>
                        <td style={{ padding: '10px', color: '#ccc' }}>{track.fileName}</td>
                        <td style={{ padding: '10px', color: '#ccc' }}>
                          {track.folderType === 'opening' ? 'Mở đầu' : track.folderType === 'priority' ? 'Ưu tiên' : 'Random'}
                        </td>
                        <td style={{ padding: '10px', color: '#ccc' }}>
                          {track.genreName || 'Mặc định'}
                        </td>
                        <td style={{ padding: '10px', color: '#ccc' }}>
                          {formatDurationShort(track.duration)}
                        </td>
                        <td style={{ padding: '10px', color: '#ccc' }}>
                          {track.codec || 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

export default ScanMusicPage

