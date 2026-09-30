import { useMemo, useState, type CSSProperties } from 'react'
import {
  extractAutopilotVideoFailurePaths,
  groupVideoRepairPathsByRoot,
  splitAutopilotVideoRoots,
} from '../utils/autopilotVideoRepair'

interface AutopilotVideoRepairActionsProps {
  error?: string
  rootVideo: string
  disabled?: boolean
}

export default function AutopilotVideoRepairActions({
  error,
  rootVideo,
  disabled = false,
}: AutopilotVideoRepairActionsProps) {
  const paths = useMemo(() => extractAutopilotVideoFailurePaths(error), [error])
  const groups = useMemo(
    () => groupVideoRepairPathsByRoot(paths, splitAutopilotVideoRoots(rootVideo)),
    [paths, rootVideo],
  )
  const primaryGroup = groups.length === 1 ? groups[0] : null
  const [isWorking, setIsWorking] = useState(false)
  const [recheckedInvalidPaths, setRecheckedInvalidPaths] = useState<string[] | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const baseDisabled = disabled || isWorking || !primaryGroup
  const postCheckPaths = recheckedInvalidPaths ?? []
  const actionDisabled = baseDisabled || postCheckPaths.length === 0
  const buttonStyle: CSSProperties = {
    padding: '5px 10px',
    borderRadius: '4px',
    border: '1px solid #64748b',
    background: '#172554',
    color: '#dbeafe',
    cursor: baseDisabled ? 'not-allowed' : 'pointer',
    opacity: baseDisabled ? 0.55 : 1,
    fontSize: '11px',
    fontWeight: 600,
  }

  if (paths.length === 0) return null
  if (!primaryGroup) {
    return (
      <div style={{ marginTop: '10px', color: '#fecaca', whiteSpace: 'pre-wrap', fontSize: '11px' }}>
        Không xác nhận được một thư mục gốc chung của video lỗi. Không bật xóa/chuẩn hóa tự động để bảo vệ file ngoài cấu hình.
      </div>
    )
  }

  const audit = async () => {
    if (baseDisabled || !window.api?.videoAuditFolder) return
    setIsWorking(true)
    setMessage(null)
    setRecheckedInvalidPaths(null)
    try {
      const result = await window.api.videoAuditFolder(primaryGroup.paths)
      if (result.invalid.length === 0) {
        setMessage(`Rà soát lại: ${primaryGroup.paths.length} file đều đọc được. Không cần xóa/chuẩn hóa. Bấm Chạy lại Autopilot.`)
        return
      }
      const reasons = result.invalidDetails?.length
        ? result.invalidDetails.map((item) => `• ${item.path}\n  Lỗi: ${item.reason}`).join('\n')
        : result.invalid.map((filePath) => `• ${filePath}`).join('\n')
      setRecheckedInvalidPaths(result.invalid)
      setMessage(`Rà soát lại xác nhận còn ${result.invalid.length}/${primaryGroup.paths.length} file lỗi:\n${reasons}\n\nChọn Xóa tất cả hoặc Chuẩn hóa & thay thế ngay.`)
    } catch (err: any) {
      setMessage(`Không thể rà soát lại video.\nChi tiết: ${err?.message || String(err)}\nCách xử lý: kiểm tra kết nối ổ/thư mục video rồi thử lại.`)
    } finally {
      setIsWorking(false)
    }
  }

  const repair = async (mode: 'delete' | 'replace') => {
    if (actionDisabled || !window.api?.autopilot?.repairInvalidVideos) return
    const label = mode === 'delete' ? 'Xóa vĩnh viễn' : 'Chuẩn hóa và thay thế'
    const preview = postCheckPaths.slice(0, 5).map((filePath) => `• ${filePath}`).join('\n')
    const more = postCheckPaths.length > 5 ? `\n... và ${postCheckPaths.length - 5} file khác.` : ''
    const warning = mode === 'delete'
      ? 'Không thể hoàn tác.'
      : 'File gốc chỉ bị thay sau khi file chuẩn hóa được FFmpeg kiểm tra hợp lệ.'
    if (!window.confirm(`${label} ${postCheckPaths.length} file còn lỗi?\n\n${preview}${more}\n\n${warning}`)) return

    setIsWorking(true)
    setMessage(null)
    try {
      const result = await window.api.autopilot.repairInvalidVideos({
        paths: postCheckPaths,
        rootDir: primaryGroup.root,
        mode,
        confirmed: true,
      })
      const failures = result.failed.map((item) => `• ${item.path}: ${item.error}`).join('\n')
      if (result.success) {
        setRecheckedInvalidPaths([])
        setMessage(`${mode === 'delete' ? 'Đã xóa' : 'Đã chuẩn hóa và thay thế'} ${result.repaired.length} file. Bấm Rà soát lại, sau đó Chạy lại Autopilot.`)
      } else {
        setRecheckedInvalidPaths(result.failed.map((item) => item.path))
        setMessage(`${result.error || 'Sửa file không hoàn tất.'}${failures ? `\n${failures}` : ''}\nCách xử lý: xử lý các file còn lỗi, rà soát lại rồi chọn thao tác tiếp.`)
      }
    } catch (err: any) {
      setMessage(`Không thể sửa video.\nChi tiết: ${err?.message || String(err)}\nCách xử lý: kiểm tra quyền đọc/ghi và dung lượng trong thư mục video, rồi thử lại.`)
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid rgba(148,163,184,0.35)' }}>
      <div style={{ fontSize: '11px', color: '#fde68a', marginBottom: '7px' }}>
        Phát hiện {paths.length} video cần xử lý. Rà soát lại trước, sau đó chọn một cách sửa.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        <button type="button" onClick={audit} disabled={baseDisabled} style={buttonStyle}>
          {isWorking ? 'Đang xử lý...' : 'Rà soát lại'}
        </button>
        <button
          type="button"
          onClick={() => repair('delete')}
          disabled={actionDisabled}
          style={{ ...buttonStyle, background: '#450a0a', color: '#fecaca', borderColor: '#ef4444', cursor: actionDisabled ? 'not-allowed' : 'pointer', opacity: actionDisabled ? 0.55 : 1 }}
        >
          Xóa tất cả file còn lỗi
        </button>
        <button
          type="button"
          onClick={() => repair('replace')}
          disabled={actionDisabled}
          style={{ ...buttonStyle, background: '#14532d', color: '#dcfce7', cursor: actionDisabled ? 'not-allowed' : 'pointer', opacity: actionDisabled ? 0.55 : 1 }}
        >
          Chuẩn hóa & thay thế ngay
        </button>
      </div>
      {recheckedInvalidPaths === null && (
        <div style={{ marginTop: '6px', color: '#94a3b8', fontSize: '11px' }}>
          Xóa/chuẩn hóa chỉ mở sau khi Rà soát lại xác nhận file vẫn lỗi.
        </div>
      )}
      {message && (
        <div style={{ marginTop: '8px', fontSize: '11px', lineHeight: 1.5, color: '#e2e8f0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {message}
        </div>
      )}
    </div>
  )
}
