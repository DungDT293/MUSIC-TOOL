import { useEffect, useState, type CSSProperties } from 'react'

type SelectedFile = {
  path: string
  name: string
  title: string
}

const fieldLabelStyle = { display: 'block', marginBottom: 4, fontWeight: 600, color: '#ddd' }
const inputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: '6px',
  border: '1px solid #444',
  background: '#1a1a1a',
  color: '#e0e0e0',
}

function SeoToolPage() {
  const [files, setFiles] = useState<SelectedFile[]>([])
  const [mode, setMode] = useState<'title' | 'genre'>('title')
  const [channelName, setChannelName] = useState<string>('Kênh của bạn')
  const [channelUrl, setChannelUrl] = useState<string>('https://www.youtube.com/')
  const [genre, setGenre] = useState<string>('General')
  const [tags, setTags] = useState<string>('') // Tags do người dùng nhập
  const [tracklistAuto, setTracklistAuto] = useState<boolean>(true)
  const [selectedIdx, setSelectedIdx] = useState<number>(0)
  const [presets, setPresets] = useState<{ name: string; channel: string; url: string; genre: string }[]>([])
  const [presetName, setPresetName] = useState<string>('')
  const [applying, setApplying] = useState<boolean>(false)
  const [progressText, setProgressText] = useState<string>('')
  const [progressPercent, setProgressPercent] = useState<number>(0)
  const [resultLog, setResultLog] = useState<string[]>([])

  const handlePickFiles = async () => {
    try {
      const picked: string[] | null = await window.api?.selectVideoFilesMulti?.()
      if (!picked || picked.length === 0) return
      const next = picked.map((p) => {
        const name = p.split(/[/\\]/).pop() || p
        const title = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
        return { path: p, name, title }
      })
      setFiles(next)
      setSelectedIdx(0)
    } catch (err) {
      console.error('[SEO] pick files error', err)
    }
  }

  const handlePickFolder = async () => {
    try {
      const folder: string | null = await window.api?.selectFolder?.()
      if (!folder) return
      const list = await window.api?.listVideosInFolderSimple?.(folder)
      const next =
        list?.map((f: any) => {
          const name = f.fileName || f.path?.split(/[/\\]/).pop() || ''
          const title = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
          return { path: f.path, name, title }
        }) || []
      if (next.length === 0) return
      setFiles(next)
      setSelectedIdx(0)
    } catch (err) {
      console.error('[SEO] pick folder error', err)
    }
  }

  const handleTitleChange = (idx: number, value: string) => {
    setFiles((prev) => prev.map((f, i) => (i === idx ? { ...f, title: value } : f)))
  }

  const yearNow = new Date().getFullYear().toString()

  const handleApplySeo = async () => {
    if (!files.length) return
    setApplying(true)
    setResultLog([])
    setProgressPercent(0)
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        setProgressText(`Đang áp dụng cho file ${i + 1}/${files.length}: ${f.name}`)
        setProgressPercent((i / files.length) * 100)
        const payload = {
          files: [{ path: f.path, title: f.title }],
          mode,
          channelName,
          channelUrl,
          genre,
          tags, // Tags do người dùng nhập
        }
        const res = await window.api?.videoSeoApply?.(payload)
        if (Array.isArray(res)) {
          res.forEach((r: any) => {
            setResultLog((prev) => [...prev, `${r.success ? '✓' : '✗'} ${r.file}${r.error ? ` - ${r.error}` : ''}`])
          })
        } else {
          setResultLog((prev) => [...prev, `✗ ${f.path} - lỗi không xác định`])
        }
      }
      setProgressPercent(100)
      setProgressText('Hoàn tất')
    } catch (err) {
      console.error('[SEO] apply error', err)
      setResultLog((prev) => [...prev, `✗ Lỗi: ${String(err)}`])
    } finally {
      setApplying(false)
    }
  }

  // Bỏ preview - không cần nữa

  // Presets lưu localStorage (tên preset, kênh, URL, genre)
  const loadPresets = () => {
    try {
      const raw = localStorage.getItem('seo-presets')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) setPresets(parsed)
      }
    } catch (err) {
      console.warn('[SEO] load presets error', err)
    }
  }

  const savePresets = (list: typeof presets) => {
    try {
      localStorage.setItem('seo-presets', JSON.stringify(list))
    } catch (err) {
      console.warn('[SEO] save presets error', err)
    }
  }

  const handleSavePreset = () => {
    if (!presetName.trim()) return
    const next = [
      ...presets.filter((p) => p.name !== presetName.trim()),
      { name: presetName.trim(), channel: channelName, url: channelUrl, genre },
    ]
    setPresets(next)
    savePresets(next)
  }

  const handleApplyPreset = (p: { name: string; channel: string; url: string; genre: string }) => {
    setChannelName(p.channel)
    setChannelUrl(p.url)
    setGenre(p.genre)
  }

  const handleDeletePreset = (name: string) => {
    const next = presets.filter((p) => p.name !== name)
    setPresets(next)
    savePresets(next)
  }

  // load presets on mount
  useEffect(() => {
    loadPresets()
  }, [])

  return (
    <div style={{ padding: '24px', background: '#121212', color: '#e0e0e0', minHeight: '100%' }}>
      <h2 style={{ marginBottom: 8 }}>8. SEO thô video</h2>
      <p style={{ color: '#b0b0b0', marginBottom: 16 }}>
        Áp metadata Title/Tags/Origin trực tiếp vào file video (trước khi upload). Mỗi file dùng đúng tiêu đề riêng.
      </p>

      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', background: '#1c1c1c', border: '1px solid #2b2b2b', borderRadius: 8, padding: 16 }}>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>1) Chọn file video</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button
              onClick={handlePickFiles}
              style={{
                padding: '10px 16px',
                border: 'none',
                borderRadius: 6,
                background: '#007acc',
                color: '#fff',
                cursor: 'pointer',
                flex: 1,
              }}
            >
              Chọn file
            </button>
            <button
              onClick={handlePickFolder}
              style={{
                padding: '10px 16px',
                border: 'none',
                borderRadius: 6,
                background: '#444',
                color: '#fff',
                cursor: 'pointer',
                flex: 1,
              }}
            >
              Chọn thư mục
            </button>
            {files.length > 0 && (
              <button
                onClick={() => {
                  setFiles([])
                  setSelectedIdx(0)
                }}
                style={{
                  padding: '10px 12px',
                  border: 'none',
                  borderRadius: 6,
                  background: '#8b0000',
                  color: '#fff',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Xóa danh sách
              </button>
            )}
          </div>
          <div
            style={{
              maxHeight: 360,
              overflowY: 'auto',
              border: '1px solid #2b2b2b',
              borderRadius: 6,
              padding: 8,
              background: '#151515',
              fontSize: 13,
            }}
          >
            {files.length === 0 && <div style={{ color: '#777' }}>Chưa chọn file.</div>}
            {files.map((f, idx) => (
              <div
                key={f.path}
                style={{
                  marginBottom: 10,
                  padding: 8,
                  borderRadius: 6,
                  background: idx === selectedIdx ? '#243040' : '#1b1b1b',
                  border: '1px solid #2b2b2b',
                }}
                onClick={() => setSelectedIdx(idx)}
              >
                <div style={{ color: '#e0e0e0', marginBottom: 4 }}>{f.name}</div>
                <input
                  style={{ ...inputStyle, background: '#0f0f0f' }}
                  value={f.title}
                  onChange={(e) => handleTitleChange(idx, e.target.value)}
                  placeholder="Tiêu đề SEO cho file này"
                />
                <div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>{f.path}</div>
              </div>
            ))}
          </div>
          {files.length > 0 && (
            <div style={{ marginTop: 8, color: '#9f9f9f', fontSize: 12 }}>
              Đã chọn {files.length} file.
            </div>
          )}
        </div>

        <div style={{ flex: '2 1 480px', background: '#1c1c1c', border: '1px solid #2b2b2b', borderRadius: 8, padding: 16 }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <label style={{ fontWeight: 600, color: '#ddd' }}>Chế độ:</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="radio" checked={mode === 'title'} onChange={() => setMode('title')} />
              Theo tiêu đề (mỗi file tự dùng tiêu đề riêng)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="radio" checked={mode === 'genre'} onChange={() => setMode('genre')} />
              Theo thể loại (dùng chung)
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div>
              <label style={fieldLabelStyle}>Tên kênh (Directors/Producers)</label>
              <input style={inputStyle} value={channelName} onChange={(e) => setChannelName(e.target.value)} />
            </div>
            <div>
              <label style={fieldLabelStyle}>URL kênh (Author/Promotion URL)</label>
              <input style={inputStyle} value={channelUrl} onChange={(e) => setChannelUrl(e.target.value)} />
            </div>
            {mode === 'genre' && (
              <div>
                <label style={fieldLabelStyle}>Thể loại (Genre)</label>
                <input style={inputStyle} value={genre} onChange={(e) => setGenre(e.target.value)} />
              </div>
            )}
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={fieldLabelStyle}>Tags (Keywords)</label>
            <textarea
              style={{
                ...inputStyle,
                minHeight: 80,
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Nhập tags/keywords cho video (mỗi tag cách nhau bằng dấu phẩy hoặc xuống dòng)"
            />
            <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>
              Tags sẽ được ghi đè vào metadata của video. Title, Subtitle và Comments sẽ dùng tiêu đề video (hoặc thể loại tùy mode).
            </div>
          </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, color: '#ddd' }}>
              <input
                type="checkbox"
                checked={tracklistAuto}
                onChange={(e) => setTracklistAuto(e.target.checked)}
              />
              Tracklist tự động (nếu audio khớp dữ liệu Tab 4)
            </label>
            <div style={{ marginTop: 6, fontSize: 12, color: '#888' }}>
            Mode tiêu đề: Title/Tags/Origin lấy theo tiêu đề từng file, bỏ qua Year/Genre nếu không cần.
            Mode thể loại: Title/Subject/Tags/Origin/Writers... dùng Genre, Year = {yearNow}.
            </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: '#ddd' }}>Preset kênh</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
              <input
                style={inputStyle}
                placeholder="Tên preset (ví dụ: Kênh A)"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
              />
              <button
                onClick={handleSavePreset}
                style={{
                  padding: '8px 12px',
                  border: 'none',
                  borderRadius: 6,
                  background: '#007acc',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                Lưu preset
              </button>
            </div>
            <div style={{ marginTop: 8, maxHeight: 180, overflowY: 'auto', border: '1px solid #2b2b2b', borderRadius: 6, padding: 8, background: '#151515' }}>
              {presets.length === 0 && <div style={{ color: '#777' }}>Chưa có preset.</div>}
              {presets.map((p) => (
                <div key={p.name} style={{ borderBottom: '1px solid #2b2b2b', paddingBottom: 6, marginBottom: 6 }}>
                  <div style={{ color: '#e0e0e0', fontWeight: 600 }}>{p.name}</div>
                  <div style={{ color: '#aaa', fontSize: 12 }}>Kênh: {p.channel}</div>
                  <div style={{ color: '#aaa', fontSize: 12 }}>URL: {p.url}</div>
                  <div style={{ color: '#aaa', fontSize: 12 }}>Genre: {p.genre}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <button
                      onClick={() => handleApplyPreset(p)}
                      style={{ padding: '6px 10px', border: 'none', borderRadius: 4, background: '#00a86b', color: '#fff', cursor: 'pointer' }}
                    >
                      Áp dụng
                    </button>
                    <button
                      onClick={() => handleDeletePreset(p.name)}
                      style={{ padding: '6px 10px', border: 'none', borderRadius: 4, background: '#8b0000', color: '#fff', cursor: 'pointer' }}
                    >
                      Xóa
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ flex: '1 1 280px', background: '#1c1c1c', border: '1px solid #2b2b2b', borderRadius: 8, padding: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Áp dụng SEO</div>
          <div style={{ marginBottom: 12, fontSize: 13, color: '#ccc', lineHeight: 1.6 }}>
            <div style={{ marginBottom: 8 }}>
              <strong>Title, Subtitle, Comments:</strong> Sẽ dùng tiêu đề video (hoặc thể loại nếu chọn mode thể loại).
            </div>
            <div>
              <strong>Tags:</strong> Sẽ dùng giá trị bạn nhập ở trên.
                </div>
          </div>
          <button
            style={{
              width: '100%',
              marginTop: 12,
              padding: '10px 12px',
              background: files.length ? '#00a86b' : '#555',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: files.length ? 'pointer' : 'not-allowed',
              opacity: applying ? 0.6 : 1,
            }}
            disabled={!files.length || applying}
            onClick={handleApplySeo}
          >
            {applying ? 'Đang áp dụng...' : `Áp dụng SEO cho ${files.length || 0} file`}
          </button>
        </div>
      </div>

      {/* Tiến trình & log */}
      {(applying || resultLog.length > 0) && (
        <div style={{ marginTop: 16, background: '#1c1c1c', border: '1px solid #2b2b2b', borderRadius: 8, padding: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8, color: '#e0e0e0' }}>Tiến trình áp dụng SEO</div>
          {applying && (
            <>
              <div style={{ height: 8, background: '#2b2b2b', borderRadius: 4, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, progressPercent)}%`,
                    background: '#00a86b',
                    transition: 'width 0.2s linear',
                  }}
                />
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: '#ccc' }}>{progressText}</div>
            </>
          )}
          {resultLog.length > 0 && (
            <div
              style={{
                marginTop: 10,
                maxHeight: 200,
                overflowY: 'auto',
                border: '1px solid #2b2b2b',
                borderRadius: 6,
                padding: 8,
                background: '#151515',
                fontSize: 12,
                color: '#ccc',
              }}
            >
              {resultLog.map((line, idx) => (
                <div key={idx}>{line}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default SeoToolPage
