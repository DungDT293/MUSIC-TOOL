import { useState } from 'react'

function getFileName(path: string): string {
  if (!path) return ''
  const parts = path.replace(/\/$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || path
}

type AuditResult = {
  valid: Array<{
    path: string
    durationSec: number
    width?: number
    height?: number
    codecName?: string
    fps?: number
    sizeBytes?: number
    formatName?: string
    bitrateBps?: number
  }>
  invalid: string[]
}

function AuditFilesTab() {
  const [folderPath, setFolderPath] = useState<string>('')
  const [isScanning, setIsScanning] = useState<boolean>(false)
  const [scanProgress, setScanProgress] = useState<{ percent: number; message: string } | null>(null)
  const [result, setResult] = useState<AuditResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState<boolean>(false)
  const [deleteInProgress, setDeleteInProgress] = useState<boolean>(false)
  const [deleteDone, setDeleteDone] = useState<{ deleted: number; errors: Array<{ path: string; message: string }> } | null>(null)

  const handleSelectFolder = async () => {
    const api = window.api  // MED-13 fix: access api inside callback, not at render scope
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
    const api = window.api  // MED-13 fix: access api inside callback
    if (!folderPath) {
      setErrorMessage('Vui lòng chọn thư mục video đã chuẩn hóa.')
      return
    }
    setErrorMessage(null)
    setResult(null)
    setShowDeleteDialog(false)
    setDeleteDone(null)
    setIsScanning(true)
    setScanProgress({ percent: 0, message: 'Đang liệt kê file trong thư mục...' })

    try {
      const list = await api?.listVideosInFolderSimple?.(folderPath)
      if (!list || !Array.isArray(list)) {
        setErrorMessage('Không đọc được danh sách video trong thư mục.')
        setIsScanning(false)
        setScanProgress(null)
        return
      }
      const paths = list.map((e: { path: string }) => e.path).filter(Boolean)
      if (paths.length === 0) {
        setResult({ valid: [], invalid: [] })
        setErrorMessage('Thư mục không có file video nào.')
        setIsScanning(false)
        setScanProgress(null)
        return
      }

      setScanProgress({ percent: 10, message: `Đang quét thông số ${paths.length} video...` })
      const audit = await api?.videoAuditFolder?.(paths)
      if (!audit) {
        setErrorMessage('Quét thất bại.')
        setIsScanning(false)
        setScanProgress(null)
        return
      }

      setResult({ valid: audit.valid || [], invalid: audit.invalid || [] })
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
    const api = window.api  // MED-13 fix: access api inside callback
    if (!result?.invalid?.length || deleteInProgress) return
    setDeleteInProgress(true)
    try {
      const res = await api?.videoDeleteFiles?.(result.invalid, folderPath)
      setDeleteDone(res ?? { deleted: 0, errors: [] })
      setResult((prev) => (prev ? { ...prev, invalid: [] } : null))
      setShowDeleteDialog(false)
    } catch (err: any) {
      setDeleteDone({ deleted: 0, errors: [{ path: '', message: err?.message || 'Xóa thất bại.' }] })
    } finally {
      setDeleteInProgress(false)
    }
  }

  const handleCloseDeleteDialog = () => {
    setShowDeleteDialog(false)
    setDeleteDone(null)
  }

  const invalidCount = result?.invalid?.length ?? 0
  const validCount = result?.valid?.length ?? 0

  return (
    <div style={{ padding: '24px', color: '#e0e0e0', backgroundColor: '#1e1e1e', minHeight: '100%' }}>
      <h3 style={{ marginBottom: '24px', fontSize: '20px', fontWeight: 'bold' }}>Rà soát file</h3>
      <p style={{ marginBottom: '20px', fontSize: '14px', color: '#aaa' }}>
        Quét <strong>toàn bộ thông số</strong> của mọi file video trong thư mục (codec, định dạng, FPS, bitrate,
        resolution, duration). Xếp vào <strong>video lỗi</strong>: hỏng / duration &lt;= 0 / probe fail, hoặc{' '}
        <strong>chênh lệch quá lớn</strong> so với đa số file (khác codec, định dạng, resolution, FPS, bitrate). Sau khi
        quét xong, có thể xóa những video lỗi nếu bạn xác nhận.
      </p>

      {/* Thư mục video đã chuẩn hóa */}
      <div style={{ marginBottom: '24px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500' }}>
          Thư mục video đã chuẩn hóa
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
          {isScanning ? 'Đang quét...' : 'Quét thư mục'}
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

      {/* Kết quả tóm tắt (khi không mở dialog) */}
      {result && !showDeleteDialog && (
        <div
          style={{
            marginBottom: '24px',
            padding: '16px',
            backgroundColor: '#2d2d2d',
            borderRadius: '4px',
            fontSize: '14px',
          }}
        >
          <div style={{ fontWeight: '500', marginBottom: '8px' }}>Kết quả rà soát</div>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>
            Thông số đã quét: codec, định dạng (container), FPS, bitrate, resolution, duration. File chênh lệch quá lớn
            so với đa số cũng xếp vào video lỗi.
          </div>
          <div style={{ color: '#aaa' }}>
            Video hợp lệ: <strong style={{ color: '#8c8' }}>{validCount}</strong> — Video lỗi:{' '}
            <strong style={{ color: invalidCount ? '#f88' : '#8c8' }}>{invalidCount}</strong>
          </div>
          {validCount > 0 && result.valid[0] && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#888' }}>
              Ví dụ file hợp lệ: {[result.valid[0].codecName && `codec ${result.valid[0].codecName}`, result.valid[0].formatName && `định dạng ${result.valid[0].formatName}`, result.valid[0].fps != null && `${result.valid[0].fps} fps`, result.valid[0].bitrateBps != null && `${(result.valid[0].bitrateBps / 1e6).toFixed(2)} Mbps`, result.valid[0].width != null && result.valid[0].height != null && `${result.valid[0].width}×${result.valid[0].height}`].filter(Boolean).join(', ')}
            </div>
          )}
          {invalidCount === 0 && <div style={{ marginTop: '8px', color: '#8c8' }}>Không có video lỗi.</div>}
        </div>
      )}

      {/* Thông báo sau khi xóa */}
      {deleteDone && !showDeleteDialog && (
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
          Đã xóa {deleteDone.deleted} video lỗi.
          {deleteDone.errors?.length > 0 && (
            <div style={{ marginTop: '8px', color: '#f88' }}>
              Không xóa được {deleteDone.errors.length} file.
            </div>
          )}
        </div>
      )}

      {/* Dialog: có video lỗi → hỏi có muốn xóa không */}
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
              maxWidth: '560px',
              width: '90%',
              maxHeight: '80vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: '600', fontSize: '18px', marginBottom: '12px' }}>Kết quả rà soát</div>
            <div style={{ marginBottom: '12px', fontSize: '14px', color: '#aaa' }}>
              Đã quét xong. <strong style={{ color: '#8c8' }}>{validCount}</strong> video hợp lệ,{' '}
              <strong style={{ color: '#f88' }}>{invalidCount}</strong> video lỗi.
            </div>
            <div style={{ marginBottom: '12px', fontSize: '13px', fontWeight: '500' }}>
              Các file video lỗi:
            </div>
            <div
              style={{
                flex: 1,
                minHeight: '120px',
                maxHeight: '240px',
                overflowY: 'auto',
                border: '1px solid #444',
                borderRadius: '4px',
                padding: '8px',
                backgroundColor: '#1a1a1a',
                fontSize: '13px',
                marginBottom: '20px',
              }}
            >
              {result.invalid.map((path, idx) => (
                <div
                  key={path}
                  style={{
                    padding: '6px 8px',
                    marginBottom: '4px',
                    backgroundColor: '#252525',
                    borderRadius: '4px',
                    color: '#e0e0e0',
                  }}
                >
                  {idx + 1}. {getFileName(path)}
                </div>
              ))}
            </div>
            <div style={{ marginBottom: '16px', fontSize: '14px', color: '#ccc' }}>
              Bạn có muốn xóa những video lỗi này không?
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
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
                Đóng
              </button>
              <button
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
                }}
              >
                {deleteInProgress ? 'Đang xóa...' : 'Xóa video lỗi'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AuditFilesTab
