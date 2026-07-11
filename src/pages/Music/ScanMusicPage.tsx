import { useState, useEffect } from 'react'
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

const SCAN_RESULT_STORAGE_KEY = 'scanResultV1'
let scanGenreCounter = 1

function createDefaultGenre(name = 'Mặc định'): MusicScanGenre {
  return {
    id: `genre-${Date.now()}-${scanGenreCounter++}`,
    name,
    priorityFolders: [],
    randomFolders: [],
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

function cleanupGenres(genres: MusicScanGenre[]): MusicScanGenre[] {
  return genres.map((genre, index) => ({
    id: genre.id || `genre-${index + 1}`,
    name: genre.name.trim() || `Thể loại ${index + 1}`,
    priorityFolders: mergeFolders([], genre.priorityFolders ?? []),
    randomFolders: mergeFolders([], genre.randomFolders ?? []),
  })).filter((genre) => genre.priorityFolders.length > 0 || genre.randomFolders.length > 0)
}

function genresFromResult(result: ScanMusicResult | null): MusicScanGenre[] {
  const genres = result?.config?.genres
  return Array.isArray(genres) && genres.length > 0 ? genres : [createDefaultGenre()]
}

function ScanMusicPage() {
  console.log('[ScanMusicPage] Component mounted/rendered')

  const [genres, setGenres] = useState<MusicScanGenre[]>(() => [createDefaultGenre()])
  const [result, setResult] = useState<ScanMusicResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
            setGenres(genresFromResult(saved))
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

  const handleSelectGenreFolders = async (id: string, field: 'priorityFolders' | 'randomFolders') => {
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
      if (res.config?.genres?.length) setGenres(res.config.genres)
    } catch (e: any) {
      const message = e?.message || 'Có lỗi xảy ra khi quét nhạc.'
      setError(scanGenres.length > 1 && message.includes('No folders provided')
        ? 'Backend dev app chưa reload nên chưa nhận payload nhiều thể loại. Tắt/mở lại dev app rồi bấm Quét nhạc.'
        : message)
    } finally {
      setLoading(false)
    }
  }

  // Lưu kết quả vào localStorage và dispatch custom event
  useEffect(() => {
    if (result) {
      localStorage.setItem(SCAN_RESULT_STORAGE_KEY, JSON.stringify(result))
      
      // Dispatch custom event để Tab 2 biết có scan mới
      window.dispatchEvent(new CustomEvent('musicScanCompleted', { detail: result }))
    }
  }, [result])

  // Listen for normalize audio progress
  useEffect(() => {
    const unsubscribe = window.api.music.onNormalizeAudioProgress?.((progress: any) => {
      setNormalizeProgress(progress)
      // Reset loading khi hoàn thành hoặc hủy
      if (progress.status === 'completed' || progress.status === 'cancelled' || progress.status === 'error') {
        setNormalizeLoading(false)
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
   * Output folder = subfolder "aac_chuanhoa" bên trong folder cha của file đầu tiên.
   */
  const handleAutoFillNonAac = () => {
    if (!result?.nonAacFiles || result.nonAacFiles.length === 0) return

    // Lấy folder cha từ file đầu tiên để tạo subfolder output
    const firstFile = result.nonAacFiles[0]
    // Tách folder cha theo path separator (Windows và Unix)
    const parts = firstFile.replace(/\\/g, '/').split('/')
    parts.pop() // bỏ tên file
    const parentFolder = parts.join('\\') // Windows path
    const autoOutputFolder = parentFolder + '\\aac_chuanhoa'

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
      // Progress sẽ được cập nhật qua progress handler với status 'cancelled'
      // Nhưng reset loading ngay để UI phản hồi nhanh
      setNormalizeLoading(false)
    } catch (err) {
      console.error('Cancel normalize error:', err)
      setNormalizeLoading(false)
    }
  }

  const handleOpenOutputFolder = async () => {
    try {
      let folderToOpen: string | null = null

      // Ưu tiên: dùng outputFolder nếu có
      if (outputFolder) {
        folderToOpen = outputFolder
      } else if (normalizeResult && normalizeResult.outputFiles.length > 0) {
        // Nếu không có outputFolder, lấy thư mục của file đầu tiên
        const firstOutputFile = normalizeResult.outputFiles[0]
        // Parse path thủ công (không dùng Node.js path trong renderer)
        const pathParts = firstOutputFile.split(/[/\\]/)
        pathParts.pop() // Bỏ tên file
        folderToOpen = pathParts.join('\\') // Windows path separator
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

      {/* Non-AAC warning banner — hiện khi scan xong và có file chưa chuẩn AAC */}
      {result && result.nonAacFiles && result.nonAacFiles.length > 0 && (
        <div
          style={{
            margin: '20px 0',
            padding: '16px 20px',
            backgroundColor: '#2d2000',
            border: '1px solid #f0a000',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
          }}
        >
          <div>
            <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#f0c040', marginBottom: '4px' }}>
              ⚠️ Phát hiện {result.nonAacFiles.length} file chưa phải chuẩn AAC
            </div>
            <div style={{ fontSize: '13px', color: '#c8a060', lineHeight: '1.5' }}>
              Các file .mp3, .wav, .flac... cần được chuẩn hóa sang AAC (.m4a) để xuất playlist nhanh hơn (stream copy, không mã hóa lại).
              File xuất sẽ được lưu vào thư mục con <strong style={{ color: '#f0c040' }}>aac_chuanhoa</strong> bên trong folder gốc, giữ nguyên tên file.
            </div>
          </div>
          <button
            onClick={handleAutoFillNonAac}
            style={{
              padding: '10px 18px',
              backgroundColor: '#f0a000',
              color: '#1a1000',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 'bold',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            Tự động điền &amp; chuẩn hóa
          </button>
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
                          {track.folderType === 'priority' ? 'Ưu tiên' : 'Random'}
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

