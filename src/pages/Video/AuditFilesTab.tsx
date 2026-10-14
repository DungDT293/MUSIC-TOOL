import { useState } from 'react'

function getFileName(path: string): string {
  if (!path) return ''
  const parts = path.replace(/\/$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || path
}

type AuditItem = {
  path: string
  durationSec: number
  width?: number
  height?: number
  codecName?: string
  fps?: number
  sizeBytes?: number
  formatName?: string
  bitrateBps?: number
  kind?: 'video' | 'audio'
}

type InvalidDetail = {
  path: string
  reason: string
  kind?: 'video' | 'audio'
}

type AuditResult = {
  valid: AuditItem[]
  invalid: string[]
  invalidDetails?: InvalidDetail[]
}

type ScanMode = 'all' | 'video' | 'audio'

function AuditFilesTab() {
  const [folderPath, setFolderPath] = useState<string>('')
  const [scanMode, setScanMode] = useState<ScanMode>('all')
  const [isScanning, setIsScanning] = useState<boolean>(false)
  const [scanProgress, setScanProgress] = useState<{ percent: number; message: string } | null>(null)
  const [result, setResult] = useState<AuditResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState<boolean>(false)
  const [deleteInProgress, setDeleteInProgress] = useState<boolean>(false)
  const [deleteDone, setDeleteDone] = useState<{ deleted: number; errors: Array<{ path: string; message: string }> } | null>(null)

  const handleSelectFolder = async () => {
    const api = window.api
    setErrorMessage(null)
    setResult(null)
    setShowDeleteDialog(false)
    setDeleteDone(null)
    try {
      const dir = await api?.selectFolder?.()
      if (dir) {
        setFolderPath(dir)
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Không chọn được thư mục.')
    }
  }

  const handleScan = async () => {
    const api = window.api
    if (!folderPath) {
      setErrorMessage('Vui lòng chọn thư mục cần rà soát.')
      return
    }
    setErrorMessage(null)
    setResult(null)
    setShowDeleteDialog(false)
    setDeleteDone(null)
    setIsScanning(true)
    setScanProgress({ percent: 0, message: 'Đang quét toàn bộ file trong thư mục và thư mục con...' })

    try {
      let paths: string[] = []

      if (api?.listMediaFilesInFolder) {
        const list = await api.listMediaFilesInFolder(folderPath, scanMode)
        paths = (list || []).map((e) => e.path).filter(Boolean)
      } else {
        const list = await api?.listVideosInFolderSimple?.(folderPath)
        paths = (list || []).map((e: { path: string }) => e.path).filter(Boolean)
      }

      if (paths.length === 0) {
        setResult({ valid: [], invalid: [], invalidDetails: [] })
        setErrorMessage('Không tìm thấy file phù hợp nào trong thư mục và các thư mục con.')
        setIsScanning(false)
        setScanProgress(null)
        return
      }

      setScanProgress({ percent: 15, message: `Đang kiểm tra kỹ thuật ${paths.length} file bằng FFprobe...` })
      const audit = await api?.videoAuditFolder?.(paths)
      if (!audit) {
        setErrorMessage('Rà soát file thất bại.')
        setIsScanning(false)
        setScanProgress(null)
        return
      }

      setResult({
        valid: audit.valid || [],
        invalid: audit.invalid || [],
        invalidDetails: audit.invalidDetails || [],
      })

      if ((audit.invalid || []).length > 0) {
        setShowDeleteDialog(true)
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Quét thư mục thất bại.')
    } finally {
      setIsScanning(false)
      setScanProgress(null)
    }
  }

  const handleConfirmDelete = async () => {
    const api = window.api
    if (!result?.invalid?.length || deleteInProgress) return
    setDeleteInProgress(true)
    try {
      const res = await api?.videoDeleteFiles?.(result.invalid, folderPath)
      const deletedCount = res?.deleted ?? 0
      setDeleteDone(res ?? { deleted: 0, errors: [] })
      setResult((prev) => (prev ? { ...prev, invalid: [], invalidDetails: [] } : null))
      setShowDeleteDialog(false)
      if (deletedCount > 0) {
        setErrorMessage(null)
      }
    } catch (err: any) {
      setDeleteDone({ deleted: 0, errors: [{ path: '', message: err?.message || 'Xóa thất bại.' }] })
    } finally {
      setDeleteInProgress(false)
    }
  }

  const handleCloseDeleteDialog = () => {
    setShowDeleteDialog(false)
  }

  const invalidCount = result?.invalid?.length ?? 0
  const validCount = result?.valid?.length ?? 0
  const validVideos = result?.valid?.filter((v) => v.kind !== 'audio').length ?? 0
  const validAudios = result?.valid?.filter((v) => v.kind === 'audio').length ?? 0

  return (
    <div style={{ padding: '24px', color: '#e0e0e0', backgroundColor: '#1e1e1e', minHeight: '100%' }}>
      <h3 style={{ marginBottom: '16px', fontSize: '20px', fontWeight: 'bold' }}>Rà soát file Video và Nhạc</h3>
      <p style={{ marginBottom: '20px', fontSize: '14px', color: '#aaa', lineHeight: '1.6' }}>
        Tự động quét sâu toàn bộ thư mục và các thư mục con để kiểm tra toàn vẹn định dạng bằng FFprobe.
        Nhận diện chính xác các file hỏng (0 byte, hỏng moov atom, thiếu duration, lỗi stream âm thanh/hình ảnh).
        Sau khi rà soát, bạn có thể xóa toàn bộ file lỗi chỉ với một thao tác.
      </p>

      {/* Chế độ rà soát */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500' }}>
          Loại tệp cần rà soát
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setScanMode('all')}
            disabled={isScanning}
            style={{
              padding: '8px 16px',
              backgroundColor: scanMode === 'all' ? '#007acc' : '#2d2d2d',
              color: '#fff',
              border: '1px solid #444',
              borderRadius: '4px',
              cursor: isScanning ? 'not-allowed' : 'pointer',
              fontSize: '13px',
              fontWeight: scanMode === 'all' ? '600' : 'normal',
            }}
          >
            Tất cả (Video và Nhạc)
          </button>
          <button
            type="button"
            onClick={() => setScanMode('video')}
            disabled={isScanning}
            style={{
              padding: '8px 16px',
              backgroundColor: scanMode === 'video' ? '#007acc' : '#2d2d2d',
              color: '#fff',
              border: '1px solid #444',
              borderRadius: '4px',
              cursor: isScanning ? 'not-allowed' : 'pointer',
              fontSize: '13px',
              fontWeight: scanMode === 'video' ? '600' : 'normal',
            }}
          >
            Chỉ Video
          </button>
          <button
            type="button"
            onClick={() => setScanMode('audio')}
            disabled={isScanning}
            style={{
              padding: '8px 16px',
              backgroundColor: scanMode === 'audio' ? '#007acc' : '#2d2d2d',
              color: '#fff',
              border: '1px solid #444',
              borderRadius: '4px',
              cursor: isScanning ? 'not-allowed' : 'pointer',
              fontSize: '13px',
              fontWeight: scanMode === 'audio' ? '600' : 'normal',
            }}
          >
            Chỉ Nhạc (Audio)
          </button>
        </div>
      </div>

      {/* Thư mục rà soát */}
      <div style={{ marginBottom: '24px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500' }}>
          Thư mục nguồn (quét đệ quy toàn bộ thư mục con)
        </label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div
            style={{
              flex: 1,
              padding: '8px 12px',
              border: '1px solid #444',
              borderRadius: '4px',
              backgroundColor: '#1a1a1a',
              minHeight: '36px',
              display: 'flex',
              alignItems: 'center',
              fontSize: '13px',
              color: folderPath ? '#e0e0e0' : '#999',
            }}
          >
            {folderPath || 'Chưa chọn thư mục'}
          </div>
          <button
            onClick={handleSelectFolder}
            disabled={isScanning}
            style={{
              padding: '8px 16px',
              backgroundColor: '#007acc',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: isScanning ? 'not-allowed' : 'pointer',
              fontSize: '14px',
            }}
          >
            Chọn thư mục
          </button>
        </div>
      </div>

      {/* Nút quét */}
      <div style={{ marginBottom: '24px' }}>
        <button
          onClick={handleScan}
          disabled={isScanning || !folderPath}
          style={{
            padding: '10px 24px',
            backgroundColor: folderPath && !isScanning ? '#007acc' : '#444',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: isScanning || !folderPath ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            fontWeight: '500',
          }}
        >
          {isScanning ? 'Đang rà soát...' : 'Bắt đầu rà soát'}
        </button>
      </div>

      {/* Progress */}
      {isScanning && scanProgress && (
        <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#2d2d2d', borderRadius: '4px' }}>
          <div style={{ marginBottom: '8px', fontSize: '14px' }}>{scanProgress.message}</div>
          <div style={{ height: '8px', backgroundColor: '#1a1a1a', borderRadius: '4px', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${scanProgress.percent}%`,
                backgroundColor: '#007acc',
                transition: 'width 0.2s',
              }}
            />
          </div>
        </div>
      )}

      {/* Lỗi */}
      {errorMessage && (
        <div
          style={{
            marginBottom: '24px',
            padding: '12px',
            backgroundColor: 'rgba(200,60,60,0.2)',
            border: '1px solid #c33',
            borderRadius: '4px',
            color: '#f88',
            fontSize: '14px',
          }}
        >
          {errorMessage}
        </div>
      )}

      {/* Thông báo sau khi xóa */}
      {deleteDone && (
        <div
          style={{
            marginBottom: '24px',
            padding: '12px',
            backgroundColor: 'rgba(80,160,80,0.2)',
            border: '1px solid #4a4',
            borderRadius: '4px',
            color: '#8c8',
            fontSize: '14px',
          }}
        >
          Đã xóa thành công {deleteDone.deleted} file lỗi khỏi ổ đĩa.
          {deleteDone.errors?.length > 0 && (
            <div style={{ marginTop: '8px', color: '#f88' }}>
              Không thể xóa {deleteDone.errors.length} file (có thể đang bị ứng dụng khác khóa).
            </div>
          )}
        </div>
      )}

      {/* Kết quả tóm tắt */}
      {result && (
        <div
          style={{
            marginBottom: '24px',
            padding: '16px',
            backgroundColor: '#2d2d2d',
            borderRadius: '4px',
            fontSize: '14px',
          }}
        >
          <div style={{ fontWeight: '600', fontSize: '16px', marginBottom: '12px' }}>Kết quả rà soát</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <div style={{ backgroundColor: '#1e1e1e', padding: '12px', borderRadius: '4px' }}>
              <div style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>File hợp lệ</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#8c8' }}>{validCount}</div>
              <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>
                Video: {validVideos} | Nhạc: {validAudios}
              </div>
            </div>
            <div style={{ backgroundColor: '#1e1e1e', padding: '12px', borderRadius: '4px' }}>
              <div style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>File lỗi / hỏng</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: invalidCount > 0 ? '#f88' : '#8c8' }}>
                {invalidCount}
              </div>
              <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>
                {invalidCount > 0 ? 'Cần xóa bỏ' : 'An toàn'}
              </div>
            </div>
          </div>

          {invalidCount > 0 && (
            <div style={{ marginTop: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontWeight: '500', color: '#f88' }}>Danh sách chi tiết file lỗi ({invalidCount}):</span>
                <button
                  type="button"
                  onClick={() => setShowDeleteDialog(true)}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#c33',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: '500',
                  }}
                >
                  Xóa tất cả file lỗi ({invalidCount})
                </button>
              </div>

              <div
                style={{
                  maxHeight: '260px',
                  overflowY: 'auto',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  backgroundColor: '#1a1a1a',
                  padding: '8px',
                }}
              >
                {(result.invalidDetails && result.invalidDetails.length > 0 ? result.invalidDetails : result.invalid.map((p) => ({ path: p, reason: 'File không hợp lệ' }))).map((item, idx) => (
                  <div
                    key={item.path}
                    style={{
                      padding: '8px',
                      marginBottom: '4px',
                      backgroundColor: '#252525',
                      borderRadius: '4px',
                      fontSize: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                      <strong style={{ color: '#fff' }}>
                        {idx + 1}. {getFileName(item.path)}
                      </strong>
                      <span
                        style={{
                          fontSize: '11px',
                          color: '#f88',
                          backgroundColor: 'rgba(200,60,60,0.2)',
                          padding: '2px 6px',
                          borderRadius: '2px',
                        }}
                      >
                        {item.kind === 'audio' ? 'Nhạc lỗi' : 'Video lỗi'}
                      </span>
                    </div>
                    <div style={{ color: '#aaa', fontSize: '11px', marginBottom: '2px', wordBreak: 'break-all' }}>
                      Đường dẫn: {item.path}
                    </div>
                    <div style={{ color: '#f99', fontSize: '11px' }}>
                      Nguyên nhân: {item.reason}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Dialog xác nhận xóa */}
      {showDeleteDialog && result && result.invalid.length > 0 && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseDeleteDialog()
          }}
        >
          <div
            style={{
              backgroundColor: '#2d2d2d',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '620px',
              width: '90%',
              maxHeight: '80vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: '600', fontSize: '18px', marginBottom: '12px', color: '#fff' }}>
              Xác nhận xóa file lỗi khỏi ổ đĩa
            </div>
            <div style={{ marginBottom: '12px', fontSize: '14px', color: '#ccc' }}>
              Phát hiện <strong style={{ color: '#f88' }}>{invalidCount}</strong> file lỗi không đọc được hoặc không có thời lượng.
              Bạn có chắc chắn muốn xóa vĩnh viễn những file này để tránh lỗi khi ghép nhạc / ghép video không?
            </div>

            <div
              style={{
                flex: 1,
                minHeight: '140px',
                maxHeight: '260px',
                overflowY: 'auto',
                border: '1px solid #444',
                borderRadius: '4px',
                padding: '8px',
                backgroundColor: '#1a1a1a',
                fontSize: '12px',
                marginBottom: '20px',
              }}
            >
              {(result.invalidDetails && result.invalidDetails.length > 0 ? result.invalidDetails : result.invalid.map((p) => ({ path: p, reason: 'File không hợp lệ' }))).map((item, idx) => (
                <div
                  key={item.path}
                  style={{
                    padding: '6px 8px',
                    marginBottom: '4px',
                    backgroundColor: '#252525',
                    borderRadius: '4px',
                  }}
                >
                  <div style={{ color: '#fff', fontWeight: '500' }}>
                    {idx + 1}. {getFileName(item.path)}
                  </div>
                  <div style={{ color: '#f88', fontSize: '11px', marginTop: '2px' }}>
                    {item.reason}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={handleCloseDeleteDialog}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#444',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleteInProgress}
                style={{
                  padding: '10px 20px',
                  backgroundColor: deleteInProgress ? '#555' : '#c33',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: deleteInProgress ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                }}
              >
                {deleteInProgress ? 'Đang xóa...' : `Xác nhận xóa ${invalidCount} file lỗi`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AuditFilesTab
