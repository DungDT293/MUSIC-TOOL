import { useState, useEffect } from 'react'
import { ScanMusicResult } from '../../types/ipc'

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

function ScanMusicPage() {
  console.log('[ScanMusicPage] Component mounted/rendered')
  
  const [priorityFolder, setPriorityFolder] = useState<string | null>(null)
  const [randomFolder, setRandomFolder] = useState<string | null>(null)
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

  useEffect(() => {
    console.log('[ScanMusicPage] useEffect - component mounted')
    return () => {
      console.log('[ScanMusicPage] useEffect cleanup - component unmounted')
    }
  }, [])

  const handleTestSystemInfo = async () => {
    try {
      const sys = await window.api.getSystemInfo()
      console.log('SYSTEM INFO:', sys)
      alert(`CPU: ${sys.cpuModel}\nCores: ${sys.cpuCores}\nRAM: ${sys.ramGB} GB\nGPU: ${sys.gpuModel || 'N/A'}\nFFmpeg: ${sys.ffmpegVersion || 'N/A'}`)
    } catch (err) {
      console.error('Failed to get system info:', err)
      alert('Failed to get system info. Check console for details.')
    }
  }

  const handleSelectPriorityFolder = async () => {
    try {
      const path = await window.api.selectFolder()
      if (path) {
        setPriorityFolder(path)
        setResult(null)
        setError(null)
      }
    } catch (err) {
      console.error('Failed to select folder:', err)
    }
  }

  const handleSelectRandomFolder = async () => {
    try {
      const path = await window.api.selectFolder()
      if (path) {
        setRandomFolder(path)
        setResult(null)
        setError(null)
      }
    } catch (err) {
      console.error('Failed to select folder:', err)
    }
  }

  const handleScan = async () => {
    if (!priorityFolder && !randomFolder) {
      setError('Vui lòng chọn ít nhất 1 thư mục.')
      return
    }

    setError(null)
    setLoading(true)
    setResult(null)

    try {
      const res = await window.api.scanMusicFolders({ priorityFolder, randomFolder })
      setResult(res)
    } catch (e: any) {
      setError(e?.message || 'Có lỗi xảy ra khi quét nhạc.')
    } finally {
      setLoading(false)
    }
  }

  // Lưu kết quả vào localStorage và dispatch custom event
  useEffect(() => {
    if (result) {
      localStorage.setItem('scanResultV1', JSON.stringify(result))
      
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

    // Scroll xuống phần normalize
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

  return (
    <div style={{ padding: '20px' }}>
      <h1 style={{ marginBottom: '20px', fontSize: '32px', fontWeight: 'bold' }}>
        Quét nhạc
      </h1>
      <p style={{ color: '#888', fontSize: '16px', lineHeight: '1.6', marginBottom: '30px' }}>
        Trang này sẽ cho phép chọn folder nhạc ưu tiên và random để quét thư viện.
      </p>

      {/* Test button (small) */}
      <div style={{ marginBottom: '30px' }}>
        <button
          onClick={handleTestSystemInfo}
          style={{
            padding: '6px 12px',
            backgroundColor: '#555',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          [TEST] Kiểm tra hệ thống
        </button>
      </div>

      {/* Folder selection */}
      <div style={{ marginBottom: '30px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Priority folder */}
        <div style={{ padding: '15px', backgroundColor: '#252526', borderRadius: '6px' }}>
          <h3 style={{ marginBottom: '10px', fontSize: '16px', fontWeight: 'bold' }}>
            Nhạc ưu tiên
          </h3>
          <div style={{ marginBottom: '10px', color: '#ccc', fontSize: '14px' }}>
            {priorityFolder || 'Chưa chọn'}
          </div>
          <button
            onClick={handleSelectPriorityFolder}
            disabled={loading}
            style={{
              padding: '8px 16px',
              backgroundColor: '#007acc',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '14px',
            }}
          >
            Chọn thư mục
          </button>
        </div>

        {/* Random folder */}
        <div style={{ padding: '15px', backgroundColor: '#252526', borderRadius: '6px' }}>
          <h3 style={{ marginBottom: '10px', fontSize: '16px', fontWeight: 'bold' }}>
            Nhạc random
          </h3>
          <div style={{ marginBottom: '10px', color: '#ccc', fontSize: '14px' }}>
            {randomFolder || 'Chưa chọn'}
          </div>
          <button
            onClick={handleSelectRandomFolder}
            disabled={loading}
            style={{
              padding: '8px 16px',
              backgroundColor: '#007acc',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '14px',
            }}
          >
            Chọn thư mục
          </button>
        </div>
      </div>

      {/* Scan button */}
      <div style={{ marginBottom: '30px' }}>
        <button
          onClick={handleScan}
          disabled={loading || (!priorityFolder && !randomFolder)}
          style={{
            padding: '12px 24px',
            backgroundColor: loading ? '#555' : '#007acc',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: loading || (!priorityFolder && !randomFolder) ? 'not-allowed' : 'pointer',
            fontSize: '16px',
            fontWeight: 'bold',
          }}
        >
          {loading ? 'Đang quét...' : 'Quét nhạc'}
        </button>
        {loading && (
          <p style={{ marginTop: '10px', color: '#888', fontSize: '14px' }}>
            Đang quét... (có thể mất vài phút nếu thư viện lớn)
          </p>
        )}
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
      <div
        id="normalize-section"
        style={{
          marginTop: '40px',
          padding: '20px',
          backgroundColor: '#1e1e1e',
          borderRadius: '8px',
          border: '1px solid #333',
        }}
      >
        <h2 style={{ marginBottom: '20px', fontSize: '24px', fontWeight: 'bold' }}>
          Chuẩn hóa bitrate âm thanh
        </h2>
        <p style={{ color: '#888', fontSize: '14px', marginBottom: '20px' }}>
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

          {/* Summary */}
          <div
            style={{
              padding: '20px',
              backgroundColor: '#252526',
              borderRadius: '6px',
              marginBottom: '30px',
            }}
          >
            <h3 style={{ marginBottom: '15px', fontSize: '18px', fontWeight: 'bold' }}>
              Tóm tắt
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px' }}>
              <div>
                <div style={{ color: '#888', fontSize: '14px', marginBottom: '5px' }}>Số bài</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold' }}>
                  <div>Ưu tiên: {result.summary.priorityCount}</div>
                  <div>Random: {result.summary.randomCount}</div>
                  <div>Tổng: {result.summary.totalCount}</div>
                </div>
              </div>
              <div>
                <div style={{ color: '#888', fontSize: '14px', marginBottom: '5px' }}>
                  Thời lượng
                </div>
                <div style={{ fontSize: '16px', fontWeight: 'bold' }}>
                  <div>Ưu tiên: {formatDuration(result.summary.priorityDuration)}</div>
                  <div>Random: {formatDuration(result.summary.randomDuration)}</div>
                  <div>Tổng: {formatDuration(result.summary.totalDuration)}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Track list (first 10) */}
          {result.tracks.length > 0 && (
            <div>
              <h3 style={{ marginBottom: '15px', fontSize: '18px', fontWeight: 'bold' }}>
                Danh sách bài hát (10 bài đầu)
              </h3>
              <div
                style={{
                  marginBottom: '10px',
                  color: '#888',
                  fontSize: '14px',
                }}
              >
                Đang hiển thị {Math.min(result.tracks.length, 10)} / {result.tracks.length} bài
                đầu tiên
              </div>
              <div
                style={{
                  overflowX: 'auto',
                  backgroundColor: '#252526',
                  borderRadius: '6px',
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
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ScanMusicPage

