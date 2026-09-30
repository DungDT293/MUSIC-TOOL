import { useState, useEffect, useCallback, useRef } from 'react'
import NumericDraftInput from '../../../components/NumericDraftInput'
import type {
  EQSettings, CompressorSettings, LoudnormSettings, StereoSettings,
  NoiseGateSettings, LimiterSettings, ExciterSettings, NoiseReductionSettings,
  EnhanceAudioProgress, EnhanceAudioResult,
} from '../../../types/ipc'
import { useAudioChain } from './useAudioChain'
import EQPanel from './EQPanel'
import CompressorPanel from './CompressorPanel'
import LoudnormPanel from './LoudnormPanel'
import StereoPanel from './StereoPanel'
import NoiseGatePanel from './NoiseGatePanel'
import LimiterPanel from './LimiterPanel'
import ExciterPanel from './ExciterPanel'
import NoiseReductionPanel from './NoiseReductionPanel'
import PresetsPanel from './PresetsPanel'
import FileList from './FileList'
import PreviewPlayer from './PreviewPlayer'
import { applyPresetDefaults, type EnhanceAudioPresetSettings } from './presets'

// ── Default settings ───────────────────────────────────────────────────────

const DEFAULT_EQ: EQSettings = {
  enabled: false,
  highpassHz: 20, lowpassHz: 22050,
  bassGainDb: 0, band1Gain: 0, midGainDb: 0, band2Gain: 0, trebleGainDb: 0,
}
const DEFAULT_COMP: CompressorSettings = {
  enabled: false, thresholdDb: -18, ratio: 4, attackMs: 5, releaseMs: 50, makeupGainDb: 2, knee: 2.83, mix: 1,
}
const DEFAULT_LOUD: LoudnormSettings = { enabled: false, integratedLufs: -14, truePeakDbtp: -1, lra: 11 }
const DEFAULT_STEREO: StereoSettings = { enabled: false, amount: 1 }
const DEFAULT_NOISE_GATE: NoiseGateSettings = {
  enabled: false, thresholdDb: -40, ratio: 6, attackMs: 5, releaseMs: 200, rangeDb: -24,
}
const DEFAULT_LIMITER: LimiterSettings = { enabled: false, thresholdDbtp: -0.5, attackMs: 1, releaseMs: 50 }
const DEFAULT_EXCITER: ExciterSettings = { enabled: false, freq: 7500, amount: 20, drive: 5, blend: 2 }
const DEFAULT_NOISE_REDUCTION: NoiseReductionSettings = { enabled: false, noiseReducDb: 15, noiseFloorDb: -50 }

interface FileItem { path: string; name: string }

// ── Main component ─────────────────────────────────────────────────────────

export default function EnhanceAudioMain() {
  // File list
  const [files, setFiles] = useState<FileItem[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  // Output settings
  const [outputDir, setOutputDir] = useState<string>('')
  const [outputFormat, setOutputFormat] = useState<'mp3' | 'aac' | 'wav' | 'keep'>('keep')
  const [bitrateKbps, setBitrateKbps] = useState<number | ''>(320)
  const [overwrite, setOverwrite] = useState(false)

  // Audio effect settings — 8 settings
  const [eq, setEQ] = useState<EQSettings>(DEFAULT_EQ)
  const [compressor, setCompressor] = useState<CompressorSettings>(DEFAULT_COMP)
  const [loudnorm, setLoudnorm] = useState<LoudnormSettings>(DEFAULT_LOUD)
  const [stereo, setStereo] = useState<StereoSettings>(DEFAULT_STEREO)
  const [noiseGate, setNoiseGate] = useState<NoiseGateSettings>(DEFAULT_NOISE_GATE)
  const [limiter, setLimiter] = useState<LimiterSettings>(DEFAULT_LIMITER)
  const [exciter, setExciter] = useState<ExciterSettings>(DEFAULT_EXCITER)
  const [noiseReduction, setNoiseReduction] = useState<NoiseReductionSettings>(DEFAULT_NOISE_REDUCTION)

  // Processing state
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<EnhanceAudioProgress | null>(null)
  const [result, setResult] = useState<EnhanceAudioResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Preview state
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewPath, setPreviewPath] = useState<string | null>(null)

  // Web Audio chain
  const chain = useAudioChain()

  // Subscribe to progress events
  useEffect(() => {
    const api = window.api
    if (!api?.music?.onEnhanceProgress) return
    const unsub = api.music.onEnhanceProgress((p: EnhanceAudioProgress) => setProgress(p))
    return () => { if (typeof unsub === 'function') unsub() }
  }, [])

  // Update Web Audio chain when settings change
  useEffect(() => { chain.updateEQ(eq) }, [eq])
  useEffect(() => { chain.updateCompressor(compressor) }, [compressor])
  useEffect(() => { chain.updateStereo(stereo) }, [stereo])

  // ── Preset apply ─────────────────────────────────────────────────────────

  const handleApplyPreset = useCallback((partial: EnhanceAudioPresetSettings) => {
    const next = applyPresetDefaults(partial, {
      eq: DEFAULT_EQ,
      compressor: DEFAULT_COMP,
      loudnorm: DEFAULT_LOUD,
      stereo: DEFAULT_STEREO,
      noiseGate: DEFAULT_NOISE_GATE,
      limiter: DEFAULT_LIMITER,
      exciter: DEFAULT_EXCITER,
      noiseReduction: DEFAULT_NOISE_REDUCTION,
    })
    setEQ(next.eq)
    setCompressor(next.compressor)
    setLoudnorm(next.loudnorm)
    setStereo(next.stereo)
    setNoiseGate(next.noiseGate)
    setLimiter(next.limiter)
    setExciter(next.exciter)
    setNoiseReduction(next.noiseReduction)
  }, [])

  // ── File management ──────────────────────────────────────────────────────

  const handleAdd = useCallback((paths: string[]) => {
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.path))
      const newItems: FileItem[] = []
      for (const p of paths) {
        if (!existing.has(p)) {
          newItems.push({ path: p, name: p.split(/[\/\\]/).pop() ?? p })
        }
      }
      return [...prev, ...newItems]
    })
    setResult(null); setError(null); setSuccess(null)
  }, [])

  const handleRemove = useCallback((paths: string[]) => {
    const toRemove = new Set(paths)
    setFiles(prev => prev.filter(f => !toRemove.has(f.path)))
    if (selectedFile && toRemove.has(selectedFile)) setSelectedFile(null)
  }, [selectedFile])

  const handleClear = useCallback(() => {
    setFiles([]); setSelectedFile(null); setResult(null); setError(null)
  }, [])

  // ── Folder selector ──────────────────────────────────────────────────────

  const handleSelectOutputDir = async () => {
    const dir = await window.api.selectFolder?.()
    if (dir) setOutputDir(dir)
  }

  // ── Loudnorm preview ─────────────────────────────────────────────────────

  const handleRequestLoudnormPreview = useCallback(async () => {
    if (!selectedFile) return
    setPreviewLoading(true)
    setError(null)
    try {
      const api = window.api
      const res = await api.music.renderLoudnormPreview({
        inputFile: selectedFile,
        integratedLufs: loudnorm.integratedLufs,
        truePeakDbtp: loudnorm.truePeakDbtp,
        lra: loudnorm.lra,
        durationSec: 30,
      })
      if (res.success && res.previewPath) {
        setPreviewPath(res.previewPath)
        const audio = chain.audioRef.current
        if (audio) {
          let url = ''
          if (api?.readFileAsBase64) {
            const fileRes = await api.readFileAsBase64(res.previewPath)
            if (fileRes?.ok && fileRes.base64) {
              const binary = atob(fileRes.base64)
              const bytes = new Uint8Array(binary.length)
              for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
              const blob = new Blob([bytes], { type: fileRes.mime ?? 'audio/mpeg' })
              url = URL.createObjectURL(blob)
            }
          }
          if (!url) {
            const norm = res.previewPath.replace(/\\/g, '/')
            url = `file:///${norm.split('/').map(encodeURIComponent).join('/')}`
          }
          audio.src = url
          audio.load()
          audio.play().catch(() => {})
        }
      } else {
        setError(res.error ?? 'Preview thất bại')
      }
    } catch (err: any) {
      setError(err?.message ?? 'Lỗi preview')
    } finally {
      setPreviewLoading(false)
    }
  }, [selectedFile, loudnorm, chain.audioRef])

  // ── Main enhance ─────────────────────────────────────────────────────────

  const handleStart = async () => {
    if (files.length === 0) { setError('Vui lòng thêm ít nhất 1 file.'); return }
    if (outputFormat !== 'keep' && typeof bitrateKbps !== 'number') { setError('Vui lòng nhập bitrate hợp lệ.'); return }
    const anyEnabled = eq.enabled || compressor.enabled || loudnorm.enabled || stereo.enabled
      || noiseGate.enabled || limiter.enabled || exciter.enabled || noiseReduction.enabled
    if (!anyEnabled) { setError('Vui lòng bật ít nhất 1 hiệu ứng.'); return }

    const normalizedBitrate = outputFormat !== 'keep' ? bitrateKbps : undefined

    setError(null); setSuccess(null); setResult(null); setProgress(null); setLoading(true)

    try {
      const api = window.api
      const req = {
        files: files.map(f => f.path),
        outputDir: outputDir || undefined,
        outputFormat,
        bitrateKbps: normalizedBitrate,
        overwrite,
        eq: eq.enabled ? eq : undefined,
        compressor: compressor.enabled ? compressor : undefined,
        loudnorm: loudnorm.enabled ? loudnorm : undefined,
        stereo: stereo.enabled ? stereo : undefined,
        noiseGate: noiseGate.enabled ? noiseGate : undefined,
        limiter: limiter.enabled ? limiter : undefined,
        exciter: exciter.enabled ? exciter : undefined,
        noiseReduction: noiseReduction.enabled ? noiseReduction : undefined,
      }
      const res: EnhanceAudioResult = await api.music.enhanceAudio(req)
      setResult(res)
      if (res.processed > 0) {
        setSuccess(`Đã nâng cấp ${res.processed}/${files.length} file thành công.`)
        if (outputDir) window.api.openPath?.(outputDir)
      }
      if (res.failed > 0) {
        setError(`${res.failed} file thất bại:\n${res.errors.map(e => `• ${e.file}: ${e.error}`).join('\n')}`)
      }
    } catch (err: any) {
      setError(err?.message ?? 'Lỗi không xác định')
    } finally {
      setLoading(false); setProgress(null)
    }
  }

  const handleStop = async () => {
    await window.api.music?.cancelEnhanceAudio?.()
  }

  // ── ETA tracking ─────────────────────────────────────────────────────────
  const startTimeRef = useRef<number | null>(null)
  useEffect(() => {
    if (loading && !startTimeRef.current) startTimeRef.current = Date.now()
    if (!loading) startTimeRef.current = null
  }, [loading])

  function getEta(): string {
    if (!progress || !startTimeRef.current || progress.percent <= 0) return ''
    const elapsed = (Date.now() - startTimeRef.current) / 1000
    const totalEstSec = elapsed / (progress.percent / 100)
    const remaining = Math.max(0, totalEstSec - elapsed)
    if (remaining < 5) return '< 5 giây'
    const m = Math.floor(remaining / 60)
    const s = Math.floor(remaining % 60)
    return m > 0 ? `~${m}p ${s}s` : `~${s}s`
  }

  // ── Percent ───────────────────────────────────────────────────────────────
  const pct = progress ? Math.round(progress.percent) : 0
  const processingIndex = progress ? progress.currentIndex : -1

  const currentSettings = { eq, compressor, loudnorm, stereo, noiseGate, limiter, exciter, noiseReduction }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '20px', height: '100%', display: 'flex', gap: '20px', overflow: 'hidden' }}>

      {/* ── Col trai ── */}
      <div style={{ width: '300px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '10px', overflow: 'hidden' }}>
        <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff' }}>Nâng cấp âm thanh</div>

        <div style={{ flex: 1, overflow: 'hidden' }}>
          <FileList
            files={files}
            onAdd={handleAdd}
            onRemove={handleRemove}
            onClear={handleClear}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
            processingIndex={processingIndex}
            outputFiles={result?.outputFiles ?? []}
            disabled={loading}
          />
        </div>

        {/* Output settings */}
        <div style={{ borderTop: '1px solid #333', paddingTop: '10px' }}>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '6px' }}>Thư mục xuất</div>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
            <input
              type="text" readOnly
              value={outputDir || 'Cùng thư mục gốc'}
              style={{ flex: 1, backgroundColor: '#1a1a1a', color: '#aaa', border: '1px solid #333', borderRadius: '4px', padding: '4px 8px', fontSize: '12px' }}
            />
            <button onClick={handleSelectOutputDir} disabled={loading}
              style={{ fontSize: '11px', padding: '4px 8px', backgroundColor: '#007acc', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              Chọn
            </button>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select value={outputFormat} onChange={e => setOutputFormat(e.target.value as any)} disabled={loading}
              style={{ flex: 1, backgroundColor: '#1a1a1a', color: '#ccc', border: '1px solid #333', borderRadius: '4px', padding: '4px 6px', fontSize: '12px' }}>
              <option value="keep">Giữ nguyên format</option>
              <option value="mp3">MP3</option>
              <option value="aac">AAC (M4A)</option>
              <option value="wav">WAV</option>
            </select>
            {outputFormat !== 'keep' && (
              <NumericDraftInput min={64} max={512} step={32} integer allowBlank value={bitrateKbps}
                onCommit={setBitrateKbps} disabled={loading}
                style={{ width: '70px', backgroundColor: '#1a1a1a', color: '#ccc', border: '1px solid #333', borderRadius: '4px', padding: '4px 6px', fontSize: '12px' }} />
            )}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', fontSize: '12px', color: '#888', cursor: 'pointer' }}>
            <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} disabled={loading} />
            Ghi đè file gốc (không tạo _enhanced)
          </label>
        </div>
      </div>

      {/* ── Col phai ── */}
      <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
        <PreviewPlayer
          chain={chain}
          selectedFilePath={previewPath ?? selectedFile}
          lufs={chain.lufs}
          gainReduction={chain.gainReduction}
          onRequestLoudnormPreview={handleRequestLoudnormPreview}
          previewLoading={previewLoading}
        />

        {/* Presets */}
        <PresetsPanel
          currentSettings={currentSettings}
          onApply={handleApplyPreset}
          disabled={loading}
        />

        {/* Noise Reduction — first (clean signal) */}
        <NoiseReductionPanel value={noiseReduction} onChange={setNoiseReduction} disabled={loading} />

        {/* Noise Gate */}
        <NoiseGatePanel value={noiseGate} onChange={setNoiseGate} disabled={loading} />

        {/* EQ */}
        <EQPanel value={eq} onChange={setEQ} disabled={loading} />

        {/* Compressor */}
        <CompressorPanel value={compressor} onChange={setCompressor} gainReduction={chain.gainReduction} disabled={loading} />

        {/* Exciter */}
        <ExciterPanel value={exciter} onChange={setExciter} disabled={loading} />

        {/* Stereo */}
        <StereoPanel value={stereo} onChange={setStereo} disabled={loading} />

        {/* Loudnorm */}
        <LoudnormPanel
          value={loudnorm} onChange={setLoudnorm}
          currentLufs={chain.lufs}
          selectedFile={selectedFile}
          disabled={loading}
          onRequestPreview={handleRequestLoudnormPreview}
          previewLoading={previewLoading}
        />

        {/* Limiter — last */}
        <LimiterPanel value={limiter} onChange={setLimiter} disabled={loading} />

        {/* Progress */}
        {loading && progress && (
          <div style={{ marginTop: '10px', padding: '10px', backgroundColor: '#1a2a1a', border: '1px solid #2d5a2d', borderRadius: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#88cc88', marginBottom: '6px' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{progress.currentFile}</span>
              <span style={{ flexShrink: 0, marginLeft: '8px' }}>
                {progress.currentIndex + 1}/{progress.totalFiles} — {pct}%{getEta() && ` (còn lại ${getEta()})`}
              </span>
            </div>
            <div style={{ height: '6px', backgroundColor: '#1a1a1a', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, backgroundColor: '#40a9ff', transition: 'width 0.3s' }} />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ marginTop: '10px', padding: '10px', backgroundColor: '#2a1a1a', border: '1px solid #662222', borderRadius: '6px', color: '#ff8888', fontSize: '12px', whiteSpace: 'pre-line' }}>
            {error}
          </div>
        )}

        {/* Success */}
        {success && !error && (
          <div style={{ marginTop: '10px', padding: '10px', backgroundColor: '#1a2a1a', border: '1px solid #2d5a2d', borderRadius: '6px', color: '#88cc88', fontSize: '12px' }}>
            {success}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '12px', marginBottom: '20px' }}>
          <button
            onClick={handleStart}
            disabled={loading || files.length === 0}
            style={{
              flex: 1, padding: '10px', fontSize: '14px', fontWeight: 'bold',
              backgroundColor: loading || files.length === 0 ? '#333' : '#007acc',
              color: loading || files.length === 0 ? '#666' : '#fff',
              border: 'none', borderRadius: '6px', cursor: loading || files.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? `Đang xử lý... (${pct}%)` : `Bắt đầu nâng cấp (${files.length} file)`}
          </button>
          {loading && (
            <button
              onClick={handleStop}
              style={{ padding: '10px 16px', backgroundColor: '#3a1f1f', color: '#ff8888', border: '1px solid #662222', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}
            >
              Dừng
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
