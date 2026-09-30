import { useEffect, useState } from 'react'
import { DiskSpaceErrorModal } from '../../components/DiskSpaceErrorModal'
import { runLimited } from '../../utils/runLimited'
import type { ExtractAudioBatchResult, VideoProgressPayload } from '../../types/ipc'

function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath
}

type VideoItem = { path: string; fileName: string; durationSec?: number }
type Result = ExtractAudioBatchResult

type ExtractAudioTabProps = {
  mp4Only?: boolean
}

function isMp4Path(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.mp4')
}

export default function ExtractAudioTab({ mp4Only = false }: ExtractAudioTabProps) {
  const [items, setItems] = useState<VideoItem[]>([])
  const [outputDir, setOutputDir] = useState('')
  const [audioFormat, setAudioFormat] = useState<'mp3' | 'wav'>('mp3')
  const [requestId, setRequestId] = useState<string | null>(null)
  const [progress, setProgress] = useState<VideoProgressPayload | null>(null)
  const [status, setStatus] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [diskError, setDiskError] = useState<string | null>(null)
  const processing = requestId !== null

  useEffect(() => {
    const unsubscribe = window.api.onVideoProgress?.((payload) => {
      if (payload.requestId !== requestId || payload.mode !== 'extract-audio') return
      if (payload.error) setError(payload.error)
      if (payload.currentFile) setProgress(payload)
      if (payload.message) setStatus(payload.message)
    })
    return unsubscribe
  }, [requestId])

  const addItems = async (paths: string[]) => {
    const existing = new Set(items.map((item) => item.path))
    const added = paths
      .filter((filePath) => !mp4Only || isMp4Path(filePath))
      .filter((filePath) => !existing.has(filePath))
      .map((filePath) => ({ path: filePath, fileName: getFileName(filePath) }))
    if (mp4Only && added.length === 0 && paths.length > 0) {
      setError('Chức năng này chỉ nhận file MP4.')
    }
    if (!added.length) return
    setItems((previous) => [...previous, ...added])
    if (mp4Only) return
    await runLimited(added.slice(0, 200), 8, async (item) => {
      try {
        const info = await window.api.videoGetFileInfo(item.path)
        if (typeof info?.durationSec === 'number' && info.durationSec > 0) {
          setItems((previous) => previous.map((entry) => entry.path === item.path ? { ...entry, durationSec: info.durationSec } : entry))
        }
      } catch { /* backend validates again */ }
    })
  }

  const selectVideos = async () => {
    setError(null)
    const paths = mp4Only
      ? (await window.api.dialog.openFile({
          title: 'Chọn file MP4',
          filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
          properties: ['openFile', 'multiSelections'],
        })).filePaths
      : await window.api.selectManyVideos?.()
    if (paths?.length) await addItems(paths)
  }

  const addFolder = async () => {
    setError(null)
    setStatus(mp4Only ? 'Đang quét nhanh thư mục...' : '')
    try {
      const folder = await window.api.selectFolder()
      if (!folder) return
      const files = mp4Only
        ? await window.api.ultraFastScanFolder(folder)
        : await window.api.listVideosInFolderSimple(folder)
      const paths = files.map((file) => file.path)
      if (mp4Only && paths.length > 0 && !paths.some(isMp4Path)) {
        setError('Thư mục không có file MP4.')
        return
      }
      if (!paths.length) {
        setError('Không tìm thấy video trong thư mục.')
        return
      }
      await addItems(paths)
    } catch (err: any) {
      setError(err?.message || 'Không thể quét thư mục video.')
    } finally {
      if (!processing) setStatus('')
    }
  }

  const start = async () => {
    if (!items.length) return setError('Vui lòng chọn ít nhất một video.')
    if (!outputDir) return setError('Vui lòng chọn thư mục xuất.')
    const id = `extract-audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setRequestId(id)
    setResult(null)
    setError(null)
    setProgress(null)
    setStatus('Đang bắt đầu tách âm thanh...')
    try {
      const next = await window.api.videoExtractAudioBatch({ inputFiles: items.map((item) => item.path), outputDir, audioFormat, mp4Only, requestId: id })
      setResult(next)
      if (!next.success && next.error) setError(next.error)
      setStatus(next.success ? `Đã tách âm thanh ${next.processed} video.` : `Đã xử lý ${next.processed} video.`)
    } catch (err: any) {
      const message = err?.message || 'Tách âm thanh thất bại.'
      if (message.includes('dung lượng') || message.includes('không đủ')) setDiskError(message)
      else setError(message)
    } finally {
      setRequestId(null)
      setProgress(null)
    }
  }

  const cancel = async () => {
    if (!requestId) return
    try {
      await window.api.videoCancelJob(requestId)
      setStatus('Đã gửi lệnh dừng...')
    } catch (err: any) {
      setError(err?.message || 'Không thể dừng tách âm thanh.')
    }
  }

  return (
    <div style={{ padding: 24, color: '#e0e0e0', backgroundColor: '#1e1e1e', minHeight: '100%' }}>
      <h3>Tách âm thanh hàng loạt</h3>
      <p style={{ color: '#aaa' }}>Tách audio từ nhiều video local, giữ nguyên thời lượng và không ghi đè file cũ.</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button onClick={selectVideos} disabled={processing}>Chọn nhiều video...</button>
        <button onClick={addFolder} disabled={processing}>Thêm từ thư mục...</button>
        <button onClick={() => setItems([])} disabled={processing}>Xóa danh sách</button>
      </div>
      <div style={{ marginBottom: 12 }}>Đã chọn: {items.length} video</div>
      <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #444', padding: 8, marginBottom: 16 }}>
        {items.length ? items.map((item, index) => <div key={item.path} style={{ padding: 5 }}>{index + 1}. {item.fileName}{item.durationSec ? ` — ${Math.floor(item.durationSec / 60)}:${String(Math.floor(item.durationSec) % 60).padStart(2, '0')}` : ''}</div>) : <span style={{ color: '#999' }}>Chưa có video nào.</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <button onClick={async () => { const dir = await window.api.selectFolder(); if (dir) setOutputDir(dir) }} disabled={processing}>Chọn thư mục xuất</button>
        <span>{outputDir || 'Chưa chọn thư mục'}</span>
      </div>
      <label style={{ display: 'block', marginBottom: 16 }}>Định dạng: <select value={audioFormat} onChange={(event) => setAudioFormat(event.target.value as 'mp3' | 'wav')} disabled={processing}><option value="mp3">MP3</option><option value="wav">WAV</option></select></label>
      {processing && <div style={{ marginBottom: 16 }}><div>{progress?.currentFile || 'Đang xử lý...'}</div><div>{progress?.currentIndex || 0} / {progress?.totalFiles || items.length} — {Math.round(progress?.percent || 0)}%</div><div>{status}</div><button onClick={cancel}>Dừng</button></div>}
      {!processing && status && <div style={{ marginBottom: 12 }}>{status}</div>}
      {result && <div style={{ marginBottom: 16, color: result.success ? '#7fdb8a' : '#ffcc80' }}>Đã xuất {result.outputPaths.length} file; lỗi {result.failed}.</div>}
      {result?.failures.length ? <div style={{ marginBottom: 16, padding: 12, border: '1px solid #7a4d00', backgroundColor: '#2d2414' }}><strong>Video lỗi ({result.failures.length})</strong>{result.failures.map((failure) => <div key={failure.inputPath} style={{ marginTop: 6, color: '#ffcc80' }}>{failure.fileName}: {failure.error}</div>)}</div> : null}
      {error && <div style={{ marginBottom: 16, color: '#ff8a80' }}>{error}</div>}
      <button onClick={start} disabled={processing || !items.length || !outputDir}>{processing ? 'Đang tách...' : 'TÁCH ÂM THANH TOÀN BỘ'}</button>
      {result?.outputPaths.length ? <button onClick={() => window.api.openPath(outputDir)} style={{ marginLeft: 8 }}>Mở thư mục xuất</button> : null}
      {diskError && <DiskSpaceErrorModal message={diskError} onClose={() => setDiskError(null)} />}
    </div>
  )
}
