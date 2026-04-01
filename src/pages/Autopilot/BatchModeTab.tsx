import React, { useEffect, useRef, useState } from 'react'
import {
  DayPlanDetailDialog,
  createDefaultOverrides,
  type DayPresetId,
  type DayPlanDetailOverrides,
} from '../AutopilotPage'

/** Một batch = 1 thể loại nhạc với cấu hình riêng */
interface BatchGenre {
  id: string
  name: string
  // Thư mục
  rootAudio: string
  rootVideo: string
  rootFinal: string
  priorityMusicFolder: string
  randomMusicFolder: string
  priorityVideoFolder: string
  autoCreateDailySubfolder: boolean
  minVideoClipsTarget: number
  // Day plans cho genre này
  dateCode: string
  playlistCount: number
  minutesPerPlaylist: number
  presetId: DayPresetId
  // Overrides (giống Plan Mode — dùng chung type)
  overrides?: DayPlanDetailOverrides
  // Trạng thái chạy
  status: 'pending' | 'running' | 'completed' | 'error'
  error?: string
}

export const BATCH_STORAGE_KEY = 'autopilotBatchConfigV1'

let batchIdCounter = 1

function createDefaultBatch(): BatchGenre {
  const now = new Date()
  const day = `${now.getDate()}`.padStart(2, '0')
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  return {
    id: `batch-${batchIdCounter++}-${Date.now()}`,
    name: '',
    rootAudio: '',
    rootVideo: '',
    rootFinal: '',
    priorityMusicFolder: '',
    randomMusicFolder: '',
    priorityVideoFolder: '',
    autoCreateDailySubfolder: true,
    minVideoClipsTarget: 1000,
    dateCode: `${day}${month}`,
    playlistCount: 10,
    minutesPerPlaylist: 30,
    presetId: 'tomorrowland',
    status: 'pending',
  }
}

export default function BatchModeTab() {
  const [batches, setBatches] = useState<BatchGenre[]>(() => {
    try {
      const raw = window.localStorage.getItem(BATCH_STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.map((b: any) => ({ ...createDefaultBatch(), ...b, status: 'pending' })) : []
    } catch {
      return []
    }
  })

  const [editingId, setEditingId] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [currentRunIndex, setCurrentRunIndex] = useState(-1)
  const [logMessages, setLogMessages] = useState<Array<{ timestamp: string; level: 'info' | 'warn' | 'error'; message: string }>>([])
  const logRef = useRef<HTMLDivElement>(null)
  const [showConfigFor, setShowConfigFor] = useState<string | null>(null)
  const [scanningBatchId, setScanningBatchId] = useState<string | null>(null)
  // Ref để tránh stale closure trong runBatch (luôn trỏ tới batches mới nhất)
  const batchesRef = useRef(batches)
  // Ref để tránh stale closure trong onStatus listener
  const currentRunIndexRef = useRef(currentRunIndex)
  // Ref để cancel toàn bộ batch loop (không phụ thuộc vào state re-render)
  const batchCancelledRef = useRef(false)
  const [scanResults, setScanResults] = useState<Record<string, { totalFiles: number; folders: Array<{ folder: string; count: number }> } | null>>({})
  const [lastSaved, setLastSaved] = useState<string | null>(null)

  // Save to localStorage
  useEffect(() => {
    batchesRef.current = batches  // Luôn sync ref với state mới nhất
    currentRunIndexRef.current = currentRunIndex  // Sync để tránh stale closure trong onStatus
    try {
      window.localStorage.setItem(BATCH_STORAGE_KEY, JSON.stringify(batches))
      if (batches.length > 0) {
        const now = new Date()
        setLastSaved(`${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`)
      }
    } catch { /* ignore */ }
  }, [batches])

  // Auto scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logMessages])

  // Subscribe autopilot progress + logs
  useEffect(() => {
    const w = window as any
    if (!w.api?.autopilot) return

    let statusUnsub: (() => void) | undefined
    let logUnsub: (() => void) | undefined

    if (typeof w.api.autopilot.onStatus === 'function') {
      statusUnsub = w.api.autopilot.onStatus((progress: any) => {
        if (progress.status === 'completed' || progress.status === 'error') {
          // Batch runner sẽ xử lý chuyển genre tiếp theo
          // Dùng ref thay vì closure để tránh stale currentRunIndex
          const idx = currentRunIndexRef.current
          setBatches(prev => prev.map((b, i) => {
            if (i !== idx) return b
            return {
              ...b,
              status: progress.status === 'completed' ? 'completed' : 'error',
              error: progress.error,
            }
          }))
        }
      })
    }

    if (typeof w.api.autopilot.onLog === 'function') {
      logUnsub = w.api.autopilot.onLog((log: any) => {
        setLogMessages(prev => [...prev, log].slice(-500))
      })
    }

    return () => {
      if (statusUnsub) statusUnsub()
      if (logUnsub) logUnsub()
    }
  }, [])  // Dùng currentRunIndexRef.current trong closure để tránh stale — không cần re-subscribe khi đổi batch

  const handleAddBatch = () => {
    const b = createDefaultBatch()
    setBatches(prev => [...prev, b])
    setEditingId(b.id)
  }

  // Export cấu hình ra file JSON
  const handleExportConfig = () => {
    const data = JSON.stringify(batches.map(b => {
      const { status, error, ...rest } = b
      return rest
    }), null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `batch-config-${new Date().toISOString().slice(0,10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Import cấu hình từ file JSON
  const handleImportConfig = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result as string)
          if (Array.isArray(parsed)) {
            const imported: BatchGenre[] = parsed.map((b: any) => ({
              ...createDefaultBatch(),
              ...b,
              id: `batch-${batchIdCounter++}-${Date.now()}`,
              status: 'pending' as const,
              error: undefined,
            }))
            setBatches(imported)
            setLastSaved(null)
          }
        } catch {
          alert('File không hợp lệ.')
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  const handleDeleteBatch = (id: string) => {
    setBatches(prev => prev.filter(b => b.id !== id))
    if (editingId === id) setEditingId(null)
  }

  const handleDuplicateBatch = (batch: BatchGenre) => {
    const copy: BatchGenre = {
      ...batch,
      id: `batch-${batchIdCounter++}-${Date.now()}`,
      name: `${batch.name} (copy)`,
      status: 'pending',
      error: undefined,
    }
    setBatches(prev => [...prev, copy])
  }

  const handleUpdateBatch = (id: string, patch: Partial<BatchGenre>) => {
    setBatches(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b))
  }

  const handleSelectFolder = async (batchId: string, field: keyof BatchGenre) => {
    const w = window as any
    if (!w.api?.selectFolder) return
    try {
      const selected: string | null = await w.api.selectFolder()
      if (!selected) return
      if (field === 'rootVideo') {
        // Multi-dir: append
        setBatches(prev => prev.map(b => {
          if (b.id !== batchId) return b
          const current = b.rootVideo || ''
          const merged = current.trim().length > 0 ? `${current.trim()}\n${selected}` : selected
          return { ...b, rootVideo: merged }
        }))
      } else {
        handleUpdateBatch(batchId, { [field]: selected } as any)
      }
    } catch { /* ignore */ }
  }

  // Chạy batch lần lượt
  const runBatch = async () => {
    const w = window as any
    if (!w.api?.autopilot?.start) {
      addLog('error', 'Autopilot backend chưa sẵn sàng.')
      return
    }

    setIsRunning(true)
    setLogMessages([])
    batchCancelledRef.current = false  // Reset cancel flag khi bắt đầu

    // Dùng batchesRef.current để tránh stale closure
    const currentBatches = batchesRef.current

    // Reset tất cả status
    setBatches(prev => prev.map(b => ({ ...b, status: 'pending', error: undefined })))

    for (let i = 0; i < currentBatches.length; i++) {
      // Kiểm tra cancel trước mỗi batch
      if (batchCancelledRef.current) {
        addLog('warn', `Đã hủy — dừng tại batch ${i + 1}.`)
        break
      }

      const batch = currentBatches[i]
      if (!batch.name.trim()) {
        addLog('warn', `Bỏ qua batch ${i + 1}: chưa đặt tên.`)
        continue
      }

      setCurrentRunIndex(i)
      setBatches(prev => prev.map((b, idx) => idx === i ? { ...b, status: 'running' } : b))

      addLog('info', `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
      addLog('info', `Bắt đầu batch ${i + 1}/${currentBatches.length}: "${batch.name}"`)

      // Tạo config cho Autopilot
      const config = {
        dayPlans: [{
          id: `batch-day-${i}`,
          dateCode: batch.dateCode,
          playlistCount: batch.playlistCount,
          minutesPerPlaylist: batch.minutesPerPlaylist,
          presetId: batch.presetId,
          overrides: batch.overrides,
        }],
        folders: {
          rootAudio: batch.rootAudio,
          rootVideo: batch.rootVideo,
          rootFinal: batch.rootFinal,
          autoCreateDailySubfolder: batch.autoCreateDailySubfolder,
          priorityMusicFolder: batch.priorityMusicFolder,
          randomMusicFolder: batch.randomMusicFolder,
          priorityVideoFolder: batch.priorityVideoFolder,
          minVideoClipsTarget: batch.minVideoClipsTarget,
        },
      }

      try {
        const res = await w.api.autopilot.start(config)
        if (!res?.ok) {
          addLog('error', `Batch "${batch.name}" lỗi: ${res?.error || 'Không rõ'}`)
          setBatches(prev => prev.map((b, idx) => idx === i ? { ...b, status: 'error', error: res?.error } : b))
          // Nếu đã cancel thì dừng luôn
          if (batchCancelledRef.current) break
          continue
        }

        // Đợi autopilot hoàn thành (timeout 4 giờ để tránh hang vĩnh viễn)
        await waitForAutopilotComplete(w, 4 * 60 * 60 * 1000, batchCancelledRef)

        // Nếu đã cancel thì dừng, không chạy batch tiếp theo
        if (batchCancelledRef.current) {
          setBatches(prev => prev.map((b, idx) => idx === i ? { ...b, status: 'error', error: 'Đã hủy' } : b))
          addLog('warn', `Batch "${batch.name}" đã bị hủy.`)
          break
        }

        // Cập nhật status từ backend
        const finalStatus = await w.api.autopilot.getStatus()
        if (finalStatus?.status === 'error' || finalStatus?.status === 'cancelling') {
          setBatches(prev => prev.map((b, idx) => idx === i ? { ...b, status: 'error', error: finalStatus.error } : b))
          addLog('error', `Batch "${batch.name}" kết thúc với lỗi.`)
        } else {
          setBatches(prev => prev.map((b, idx) => idx === i ? { ...b, status: 'completed' } : b))
          addLog('info', `Batch "${batch.name}" hoàn thành!`)
        }
      } catch (err: any) {
        if (batchCancelledRef.current) {
          setBatches(prev => prev.map((b, idx) => idx === i ? { ...b, status: 'error', error: 'Đã hủy' } : b))
          addLog('warn', `Batch "${batch.name}" đã bị hủy.`)
          break
        }
        addLog('error', `Batch "${batch.name}" exception: ${err?.message}`)
        setBatches(prev => prev.map((b, idx) => idx === i ? { ...b, status: 'error', error: err?.message } : b))
      }

      // Nghỉ 2s giữa các batch để cleanup (chỉ khi chưa cancel)
      if (!batchCancelledRef.current && i < currentBatches.length - 1) {
        addLog('info', `Nghỉ 2s trước batch tiếp theo...`)
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    }

    if (!batchCancelledRef.current) {
      addLog('info', `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
      addLog('info', `Batch Mode hoàn thành! Đã xử lý ${currentBatches.length} thể loại.`)
    }
    setIsRunning(false)
    setCurrentRunIndex(-1)
  }

  const handleCancel = async () => {
    const w = window as any
    // Đánh dấu cancel ngay lập tức — loop sẽ dừng ở iteration tiếp theo
    batchCancelledRef.current = true
    addLog('warn', 'Đang dừng Batch Mode...')
    try {
      // Gửi lệnh cancel xuống backend để dừng autopilot đang chạy
      await w.api?.autopilot?.cancel()
    } catch { /* ignore */ } finally {
      setIsRunning(false)
      setCurrentRunIndex(-1)
      setBatches(prev => prev.map(b => b.status === 'running' ? { ...b, status: 'error', error: 'Đã hủy' } : b))
      addLog('warn', 'Đã hủy Batch Mode.')
    }
  }

  function addLog(level: 'info' | 'warn' | 'error', message: string) {
    const ts = new Date().toLocaleTimeString('vi-VN')
    setLogMessages(prev => [...prev, { timestamp: ts, level, message }].slice(-500))
  }

  // Helpers
  const canStart = batches.length > 0 && batches.some(b => b.name.trim())

  const completedCount = batches.filter(b => b.status === 'completed').length
  const errorCount = batches.filter(b => b.status === 'error').length

  // ── STYLES ──
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '5px 8px',
    borderRadius: '4px',
    border: '1px solid #4b5563',
    backgroundColor: '#020617',
    color: '#e5e7eb',
    fontSize: '12px',
  }

  const btnSmall: React.CSSProperties = {
    padding: '3px 10px',
    borderRadius: '4px',
    border: '1px solid #4b5563',
    backgroundColor: '#030712',
    color: '#e5e7eb',
    cursor: 'pointer',
    fontSize: '11px',
    whiteSpace: 'nowrap',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', color: '#e5e7eb' }}>
      {/* Header */}
      <div>
        <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af', lineHeight: 1.5 }}>
          Tạo danh sách thể loại nhạc, mỗi loại có bộ thư mục riêng. Batch Mode sẽ chạy Autopilot lần lượt từng thể loại.
        </p>
      </div>

      {/* Danh sách batches */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {batches.map((batch, idx) => {
          const isEditing = editingId === batch.id
          const statusColor = batch.status === 'completed' ? '#4ade80'
            : batch.status === 'error' ? '#f87171'
            : batch.status === 'running' ? '#60a5fa'
            : '#6b7280'
          const statusIcon = batch.status === 'completed' ? 'Xong'
            : batch.status === 'error' ? 'Lỗi'
            : batch.status === 'running' ? 'Đang chạy'
            : `${idx + 1}.`

          return (
            <div
              key={batch.id}
              style={{
                border: isEditing ? '1px solid #3b82f6' : '1px solid #333',
                borderRadius: '8px',
                backgroundColor: isEditing ? '#0c1a30' : '#111827',
                overflow: 'hidden',
              }}
            >
              {/* Row header — luôn hiện */}
              <div
                onClick={() => setEditingId(isEditing ? null : batch.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 12px',
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: '14px', minWidth: '24px' }}>{statusIcon}</span>
                <span style={{ flex: 1, fontWeight: 500, color: batch.name ? '#e5e7eb' : '#6b7280', fontSize: '14px' }}>
                  {batch.name || '(Chưa đặt tên)'}
                </span>
                <span style={{ fontSize: '12px', color: '#9ca3af' }}>
                  {batch.playlistCount} pl × {batch.minutesPerPlaylist} phút
                </span>
                <span style={{ fontSize: '11px', color: statusColor, fontWeight: 500 }}>
                  {batch.status === 'running' ? 'Đang chạy...' : batch.status === 'completed' ? 'Xong' : batch.status === 'error' ? 'Lỗi' : ''}
                </span>
                {!isRunning && (
                  <div style={{ display: 'flex', gap: '4px' }} onClick={e => e.stopPropagation()}>
                    <button type="button" onClick={() => handleDuplicateBatch(batch)} style={btnSmall} title="Nhân bản">Nhân bản</button>
                    <button
                      type="button"
                      onClick={() => handleDeleteBatch(batch.id)}
                      style={{ ...btnSmall, color: '#f87171', borderColor: '#7f1d1d' }}
                      title="Xóa"
                    >
                      ✕
                    </button>
                  </div>
                )}
                <span style={{ fontSize: '14px', color: '#6b7280' }}>{isEditing ? '^' : 'v'}</span>
              </div>

              {/* Expanded form */}
              {isEditing && (
                <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid #1e293b' }}>
                  <div style={{ paddingTop: '10px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <label style={{ minWidth: '120px', fontSize: '12px', color: '#9ca3af' }}>Tên thể loại</label>
                    <input
                      value={batch.name}
                      onChange={e => handleUpdateBatch(batch.id, { name: e.target.value })}
                      placeholder="VD: Tomorrowland, Lofi, Party Mix..."
                      style={{ ...inputStyle, fontWeight: 500, color: '#93c5fd' }}
                      autoFocus
                      disabled={isRunning}
                    />
                  </div>

                  {/* Sản xuất */}
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <label style={{ minWidth: '120px', fontSize: '12px', color: '#9ca3af' }}>Ngày (ddMM)</label>
                    <input
                      value={batch.dateCode}
                      onChange={e => handleUpdateBatch(batch.id, { dateCode: e.target.value })}
                      style={{ ...inputStyle, width: '80px' }}
                      disabled={isRunning}
                    />
                    <label style={{ fontSize: '12px', color: '#9ca3af', marginLeft: '8px' }}>Số playlist</label>
                    <input
                      type="number" min={1}
                      value={batch.playlistCount}
                      onChange={e => handleUpdateBatch(batch.id, { playlistCount: Number(e.target.value) || 1 })}
                      style={{ ...inputStyle, width: '70px' }}
                      disabled={isRunning}
                    />
                    <label style={{ fontSize: '12px', color: '#9ca3af', marginLeft: '8px' }}>Phút/pl</label>
                    <input
                      type="number" min={1}
                      value={batch.minutesPerPlaylist}
                      onChange={e => handleUpdateBatch(batch.id, { minutesPerPlaylist: Number(e.target.value) || 1 })}
                      style={{ ...inputStyle, width: '70px' }}
                      disabled={isRunning}
                    />
                    <select
                      value={batch.presetId}
                      onChange={e => handleUpdateBatch(batch.id, { presetId: e.target.value as DayPresetId })}
                      style={{ ...inputStyle, width: '150px' }}
                      disabled={isRunning}
                    >
                      <option value="tomorrowland">Tomorrowland 2025</option>
                      <option value="partymix">Party Mix 2025</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>

                  {/* Thư mục */}
                  <div style={{ fontSize: '12px', fontWeight: 500, color: '#9ca3af', marginTop: '4px' }}>Thư mục</div>
                  {([
                    ['rootAudio', 'Audio xuất'],
                    ['rootVideo', 'Video đã cắt'],
                    ['rootFinal', 'Video hoàn chỉnh'],
                    ['priorityMusicFolder', 'Nhạc ưu tiên'],
                    ['randomMusicFolder', 'Nhạc random'],
                    ['priorityVideoFolder', 'Video ưu tiên (tùy chọn)'],
                  ] as const).map(([field, label]) => (
                    <div key={field} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                      <label style={{ minWidth: '120px', fontSize: '11px', color: '#6b7280', paddingTop: '6px' }}>{label}</label>
                      <textarea
                        readOnly
                        value={(batch as any)[field] || ''}
                        rows={Math.max(1, ((batch as any)[field] || '').split('\n').length)}
                        style={{
                          ...inputStyle,
                          flex: 1,
                          resize: 'vertical',
                          minHeight: '30px',
                          wordBreak: 'break-all',
                          whiteSpace: 'pre-wrap',
                          fontFamily: 'monospace',
                          fontSize: '11px',
                          lineHeight: '1.4',
                        }}
                        title={(batch as any)[field] || ''}
                      />
                      <button type="button" onClick={() => handleSelectFolder(batch.id, field)} style={btnSmall} disabled={isRunning}>Chọn</button>
                      <button
                        type="button"
                        onClick={() => handleUpdateBatch(batch.id, { [field]: '' } as any)}
                        style={{ ...btnSmall, color: '#f87171', fontSize: '10px' }}
                        disabled={isRunning}
                      >
                        Xóa
                      </button>
                    </div>
                  ))}

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label style={{ minWidth: '120px', fontSize: '11px', color: '#6b7280' }}>Clip mục tiêu</label>
                    <input
                      type="number" min={100} max={100000} step={100}
                      value={batch.minVideoClipsTarget}
                      onChange={e => {
                        const v = Math.min(100000, Math.max(100, Number(e.target.value) || 1000))
                        handleUpdateBatch(batch.id, { minVideoClipsTarget: v })
                      }}
                      style={{ ...inputStyle, width: '100px' }}
                      disabled={isRunning}
                    />
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#6b7280', marginLeft: '16px' }}>
                      <input
                        type="checkbox"
                        checked={batch.autoCreateDailySubfolder}
                        onChange={e => handleUpdateBatch(batch.id, { autoCreateDailySubfolder: e.target.checked })}
                        disabled={isRunning}
                      />
                      Tạo thư mục con theo ngày
                    </label>
                  </div>

                  {/* Nút Cấu hình + Quét video */}
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setShowConfigFor(showConfigFor === batch.id ? null : batch.id)
                      }}
                      disabled={isRunning}
                      style={{ ...btnSmall, backgroundColor: '#1e3a5f', color: '#93c5fd', padding: '4px 12px' }}
                    >
                      Cấu hình chi tiết
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        if (!batch.rootVideo || batch.rootVideo.trim().length === 0) return
                        setScanningBatchId(batch.id)
                        setScanResults(prev => ({ ...prev, [batch.id]: null }))
                        try {
                          const w = window as any
                          const result = await w.api?.autopilot?.scanVideoFolders?.(batch.rootVideo)
                          setScanResults(prev => ({ ...prev, [batch.id]: result }))
                        } catch {
                          setScanResults(prev => ({ ...prev, [batch.id]: { totalFiles: 0, folders: [] } }))
                        }
                        setScanningBatchId(null)
                      }}
                      disabled={isRunning || !batch.rootVideo || scanningBatchId === batch.id}
                      style={{
                        ...btnSmall,
                        backgroundColor: scanningBatchId === batch.id ? '#374151' : '#0f3520',
                        color: scanningBatchId === batch.id ? '#9ca3af' : '#4ade80',
                        padding: '4px 12px',
                      }}
                    >
                      {scanningBatchId === batch.id ? 'Đang quét...' : 'Quét video'}
                    </button>

                    {scanResults[batch.id] && (
                      <span style={{ fontSize: '12px', color: scanResults[batch.id]!.totalFiles > 0 ? '#4ade80' : '#fbbf24', fontWeight: 500 }}>
                        {scanResults[batch.id]!.totalFiles.toLocaleString()} video
                        {scanResults[batch.id]!.folders.length > 1 && ` (${scanResults[batch.id]!.folders.length} thư mục)`}
                      </span>
                    )}
                  </div>

                  {/* Kết quả quét video chi tiết */}
                  {scanResults[batch.id] && scanResults[batch.id]!.folders.length > 0 && (
                    <div style={{ fontSize: '11px', color: '#9ca3af', padding: '4px 8px', backgroundColor: '#0f172a', borderRadius: '4px', maxHeight: '100px', overflowY: 'auto' }}>
                      {scanResults[batch.id]!.folders.map((f: any, i: number) => (
                        <div key={i}>
                          {f.folder.split(/[\\/]/).pop()}: <strong style={{ color: f.count > 0 ? '#4ade80' : '#f87171' }}>{f.count.toLocaleString()}</strong> video
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Sử dụng DayPlanDetailDialog giống hệt Plan Mode */}
                  <DayPlanDetailDialog
                    plan={showConfigFor === batch.id ? {
                      id: batch.id,
                      dateCode: batch.dateCode,
                      playlistCount: batch.playlistCount,
                      minutesPerPlaylist: batch.minutesPerPlaylist,
                      presetId: batch.presetId,
                      overrides: batch.overrides,
                    } : null}
                    overrides={batch.overrides || createDefaultOverrides()}
                    open={showConfigFor === batch.id}
                    onClose={() => setShowConfigFor(null)}
                    onSave={(newOverrides) => {
                      handleUpdateBatch(batch.id, { overrides: newOverrides })
                    }}
                    foldersConfig={{
                      rootAudio: batch.rootAudio,
                      rootVideo: batch.rootVideo,
                      rootFinal: batch.rootFinal,
                      autoCreateDailySubfolder: batch.autoCreateDailySubfolder,
                      priorityMusicFolder: batch.priorityMusicFolder,
                      randomMusicFolder: batch.randomMusicFolder,
                      priorityVideoFolder: batch.priorityVideoFolder,
                    }}
                  />

                  {batch.error && (
                    <div style={{ fontSize: '12px', color: '#f87171', padding: '4px 8px', backgroundColor: '#450a0a', borderRadius: '4px' }}>
                      Lỗi: {batch.error}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Nút thêm + lưu/xuất/nhập + chạy */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handleAddBatch}
          disabled={isRunning}
          style={{
            padding: '8px 14px',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: isRunning ? '#374151' : '#2563eb',
            color: '#fff',
            cursor: isRunning ? 'not-allowed' : 'pointer',
            fontSize: '13px',
          }}
        >
          + Thêm thể loại
        </button>

        <button
          type="button"
          onClick={handleExportConfig}
          disabled={isRunning || batches.length === 0}
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            border: '1px solid #4b5563',
            backgroundColor: '#1f2937',
            color: '#e5e7eb',
            cursor: batches.length === 0 ? 'not-allowed' : 'pointer',
            fontSize: '12px',
          }}
          title="Xuất cấu hình ra file JSON"
        >
          Xuất cấu hình
        </button>

        <button
          type="button"
          onClick={handleImportConfig}
          disabled={isRunning}
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            border: '1px solid #4b5563',
            backgroundColor: '#1f2937',
            color: '#e5e7eb',
            cursor: isRunning ? 'not-allowed' : 'pointer',
            fontSize: '12px',
          }}
          title="Nhập cấu hình từ file JSON"
        >
          Nhập cấu hình
        </button>

        {lastSaved && (
          <span style={{ fontSize: '11px', color: '#6b7280' }}>
            Tự động lưu lúc {lastSaved}
          </span>
        )}

        {!isRunning ? (
          <button
            type="button"
            onClick={runBatch}
            disabled={!canStart}
            style={{
              padding: '8px 20px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: canStart ? '#16a34a' : '#64748b',
              color: '#fff',
              cursor: canStart ? 'pointer' : 'not-allowed',
              fontSize: '13px',
              fontWeight: 'bold',
            }}
            title={canStart ? `Chạy ${batches.length} thể loại lần lượt` : 'Thêm ít nhất 1 thể loại có tên'}
          >
            Chạy Batch ({batches.length} thể loại)
          </button>
        ) : (
          <button
            type="button"
            onClick={handleCancel}
            style={{
              padding: '8px 20px',
              borderRadius: '6px',
              border: '1px solid #f87171',
              backgroundColor: '#450a0a',
              color: '#fecaca',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 'bold',
            }}
          >
            Hủy Batch
          </button>
        )}

        {(completedCount > 0 || errorCount > 0) && (
          <span style={{ fontSize: '12px', color: '#9ca3af' }}>
            {completedCount > 0 && <span style={{ color: '#4ade80' }}>{completedCount} xong</span>}
            {completedCount > 0 && errorCount > 0 && ' · '}
            {errorCount > 0 && <span style={{ color: '#f87171' }}>{errorCount} lỗi</span>}
          </span>
        )}
      </div>

      {/* Log */}
      {logMessages.length > 0 && (
        <section style={{
          border: '1px solid #374151',
          borderRadius: '8px',
          padding: '12px',
          backgroundColor: '#0b1220',
        }}>
          <h3 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>Log Batch Mode</h3>
          <div
            ref={logRef}
            style={{
              backgroundColor: '#0f172a',
              border: '1px solid #1f2937',
              borderRadius: '6px',
              padding: '8px',
              height: '240px',
              overflowY: 'auto',
              fontFamily: 'monospace',
              fontSize: '12px',
              color: '#e2e8f0',
            }}
          >
            {logMessages.map((log, idx) => (
              <div key={idx} style={{ marginBottom: '3px', whiteSpace: 'pre-wrap' }}>
                <span style={{ color: '#60a5fa' }}>{log.timestamp}</span>{' '}
                <span style={{ color: log.level === 'error' ? '#f87171' : log.level === 'warn' ? '#fbbf24' : '#a5f3fc' }}>
                  [{log.level.toUpperCase()}]
                </span>{' '}
                <span>{log.message}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

/** Đợi autopilot hoàn thành (poll getStatus mỗi 2s) */
async function waitForAutopilotComplete(w: any, timeoutMs = 4 * 60 * 60 * 1000, cancelledRef?: React.MutableRefObject<boolean>): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()
    const check = async () => {
      // Nếu đã cancel → resolve ngay (không reject, để caller tự xử lý)
      if (cancelledRef?.current) {
        resolve()
        return
      }
      // Timeout guard — tránh hang vĩnh viễn
      if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Autopilot timeout sau ${Math.round(timeoutMs / 60000)} phút`))
        return
      }
      try {
        const status = await w.api.autopilot.getStatus()
        if (status?.status === 'idle' || status?.status === 'completed' || status?.status === 'completed_with_errors' || status?.status === 'error' || status?.status === 'cancelling') {
          resolve()
          return
        }
      } catch { /* ignore */ }
      setTimeout(check, 2000)
    }
    // Đợi 3s trước lần check đầu tiên (cho autopilot khởi động)
    setTimeout(check, 3000)
  })
}
