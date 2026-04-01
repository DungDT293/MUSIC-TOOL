import { useState, useCallback } from 'react'
import type { ExportHistoryEntry } from '../../../types/ipc'

interface FileItem {
  path: string
  name: string
  exists?: boolean
}

interface Props {
  files: FileItem[]
  onAdd: (paths: string[]) => void
  onRemove: (paths: string[]) => void
  onClear: () => void
  selectedFile: string | null
  onSelectFile: (path: string) => void
  processingIndex?: number
  outputFiles?: string[]
  disabled?: boolean
}

export default function FileList({
  files, onAdd, onRemove, onClear, selectedFile, onSelectFile,
  processingIndex, outputFiles = [], disabled,
}: Props) {
  const [showHistoryPicker, setShowHistoryPicker] = useState(false)
  const [history, setHistory] = useState<ExportHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [selectedInList, setSelectedInList] = useState<Set<string>>(new Set())

  const handleAddFiles = async () => {
    const paths = await window.api.selectAudioFilesMulti?.()
    if (paths && paths.length > 0) onAdd(paths)
  }

  const handleAddFolder = async () => {
    const folder = await window.api.selectFolder?.()
    if (!folder) return
    // Scan folder for audio files via IPC
    try {
      // Use existing scanMusicFolders or just open dialog
      onAdd([folder + '/*']) // marker for folder — index.tsx handles it
    } catch { /* ignore */ }
  }

  const handleOpenHistory = async () => {
    setShowHistoryPicker(true)
    setHistoryLoading(true)
    try {
      const api = window.api
      let hist: ExportHistoryEntry[] = []
      if (api?.music?.getExportHistory) {
        hist = await api.music.getExportHistory()
      }
      setHistory((hist || []).sort((a: ExportHistoryEntry, b: ExportHistoryEntry) => b.exportedAt - a.exportedAt))
    } catch (err) {
      console.error('[FileList] getExportHistory error', err)
    } finally {
      setHistoryLoading(false)
    }
  }

  const handleImportFromHistory = (entry: ExportHistoryEntry) => {
    const paths = entry.tracks.map(t => t.path).filter(Boolean)
    if (paths.length > 0) onAdd(paths)
    setShowHistoryPicker(false)
  }

  const toggleSelect = (path: string) => {
    const next = new Set(selectedInList)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    setSelectedInList(next)
  }

  const handleRemoveSelected = () => {
    onRemove(Array.from(selectedInList))
    setSelectedInList(new Set())
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '8px' }}>
      {/* Buttons */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        <button
          onClick={handleAddFiles} disabled={disabled}
          style={{ fontSize: '12px', padding: '5px 10px', backgroundColor: '#007acc', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          + Thêm file
        </button>
        <button
          onClick={handleOpenHistory} disabled={disabled}
          style={{ fontSize: '12px', padding: '5px 10px', backgroundColor: '#2d2d2d', color: '#aaa', border: '1px solid #444', borderRadius: '4px', cursor: 'pointer' }}
        >
          Lịch sử
        </button>
        {selectedInList.size > 0 && (
          <button
            onClick={handleRemoveSelected} disabled={disabled}
            style={{ fontSize: '12px', padding: '5px 10px', backgroundColor: '#3a1f1f', color: '#ff8888', border: '1px solid #662222', borderRadius: '4px', cursor: 'pointer' }}
          >
            Xóa ({selectedInList.size})
          </button>
        )}
        {files.length > 0 && (
          <button
            onClick={onClear} disabled={disabled}
            style={{ fontSize: '12px', padding: '5px 10px', backgroundColor: '#2d2d2d', color: '#888', border: '1px solid #444', borderRadius: '4px', cursor: 'pointer', marginLeft: 'auto' }}
          >
            Xóa tất cả
          </button>
        )}
      </div>

      {/* File list */}
      <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #333', borderRadius: '4px', backgroundColor: '#1a1a1a' }}>
        {files.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#555', fontSize: '13px' }}>
            Chưa có file nào.<br />Thêm file hoặc chọn từ lịch sử.
          </div>
        ) : (
          files.map((f, i) => {
            const isProcessing = processingIndex === i
            const isDone = outputFiles.some(o => o.includes(f.name.replace(/\.[^.]+$/, '')))
            const isSelected = selectedFile === f.path
            const isChecked = selectedInList.has(f.path)

            return (
              <div
                key={f.path}
                onClick={() => onSelectFile(f.path)}
                style={{
                  display: 'flex', alignItems: 'center', padding: '6px 8px',
                  borderBottom: '1px solid #2a2a2a', cursor: 'pointer',
                  backgroundColor: isSelected ? '#1a2a3a' : isProcessing ? '#1a2a1a' : 'transparent',
                }}
              >
                <input
                  type="checkbox" checked={isChecked}
                  onClick={e => e.stopPropagation()}
                  onChange={() => toggleSelect(f.path)}
                  style={{ marginRight: '8px', cursor: 'pointer' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '12px', color: isDone ? '#22c55e' : isProcessing ? '#40a9ff' : '#ccc',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {isProcessing ? '[>] ' : isDone ? '[OK] ' : ''}{f.name}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Stats */}
      {files.length > 0 && (
        <div style={{ fontSize: '11px', color: '#666', textAlign: 'center' }}>
          {files.length} file • {outputFiles.length} đã xử lý
        </div>
      )}

      {/* History picker modal */}
      {showHistoryPicker && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        }}>
          <div style={{ backgroundColor: '#252526', borderRadius: '8px', padding: '16px', width: '500px', maxHeight: '70vh', display: 'flex', flexDirection: 'column', border: '1px solid #444' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '14px' }}>Chọn từ lịch sử playlist đã xuất</span>
              <button onClick={() => setShowHistoryPicker(false)} style={{ background: 'none', border: 'none', color: '#aaa', fontSize: '18px', cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {historyLoading ? (
                <div style={{ color: '#888', textAlign: 'center', padding: '20px' }}>Đang tải...</div>
              ) : history.length === 0 ? (
                <div style={{ color: '#555', textAlign: 'center', padding: '20px' }}>Chưa có lịch sử xuất nhạc.</div>
              ) : (
                history.map(entry => (
                  <div
                    key={entry.id}
                    onClick={() => handleImportFromHistory(entry)}
                    style={{
                      padding: '8px 10px', borderBottom: '1px solid #333', cursor: 'pointer',
                      borderRadius: '4px', marginBottom: '2px',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#2d3a2d')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <div style={{ fontSize: '13px', color: '#ccc' }}>{entry.playlistName}</div>
                    <div style={{ fontSize: '11px', color: '#666' }}>
                      {new Date(entry.exportedAt).toLocaleString()} • {entry.tracks.length} bài
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
