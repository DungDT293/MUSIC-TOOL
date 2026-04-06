/**
 * Bước 6 — Decode audio từ file URL (file://) để feed Timeline Worker.
 * Ưu tiên decode trong main (ffmpeg) để tránh crash renderer (ACCESS_VIOLATION).
 * Fallback: Web Audio API trong renderer nếu main decode không có hoặc lỗi.
 */

export interface DecodedAudio {
  channelData: Float32Array
  sampleRate: number
  /** Thời lượng dùng cho UI/transport: ưu tiên realFileDurationSec từ ffprobe, không thì duration từ decode. */
  duration: number
}

/** Chuyển file:// hoặc app://local-file/?path=... thành đường dẫn file cho main process (ffmpeg/read). */
function fileUrlToPath(fileUrl: string): string {
  if (!fileUrl) return fileUrl
  if (fileUrl.startsWith('app://local-file')) {
    try {
      const u = new URL(fileUrl)
      const p = u.searchParams.get('path')
      if (p) return decodeURIComponent(p)
    } catch {
      // ignore
    }
    // Malformed URL (missing ?path=) — cannot extract path
    console.warn('[decodeAudioFromFileUrl] Malformed app:// URL, cannot extract path:', fileUrl.slice(0, 80))
    return fileUrl
  }
  if (!fileUrl.startsWith('file://')) return fileUrl
  const withoutProtocol = fileUrl.replace(/^file:\/\/\//, '').replace(/^file:\/\//, '')
  try {
    return decodeURIComponent(withoutProtocol)
  } catch {
    return withoutProtocol
  }
}

declare const window: Window & {
  api?: {
    songNhac?: {
      readAudioFile: (path: string) => Promise<Uint8Array>
      decodeAudioForTimeline?: (path: string) => Promise<{
        ok?: boolean
        info?: any
        error?: string
        // Legacy fields (if handler ever returns PCM directly)
        buffer?: Uint8Array
        sampleRate?: number
        duration?: number
      }>
    }
  }
}

// Giới hạn khi dùng Web Audio fallback
const MAX_DECODE_BYTES =
  typeof import.meta !== 'undefined' && import.meta.env?.DEV
    ? 40 * 1024 * 1024
    : 150 * 1024 * 1024

export async function decodeAudioFromFileUrl(fileUrl: string): Promise<DecodedAudio> {
  const path = fileUrlToPath(fileUrl)
  const api = window.api?.songNhac
  if (!api) throw new Error('songNhac API not available')

  // Ưu tiên: lấy metadata từ main (ffprobe) để có duration chính xác.
  // Sau đó decode PCM bằng Web Audio.
  let realFileDurationSec: number | undefined
  if (api.decodeAudioForTimeline) {
    try {
      const result = await api.decodeAudioForTimeline(path)
      if (result.ok && result.info) {
        // ffprobe returns: { format: { duration: "123.45" }, streams: [{ sample_rate: "44100" }] }
        const ffDuration = parseFloat(result.info?.format?.duration)
        if (isFinite(ffDuration) && ffDuration > 0) {
          realFileDurationSec = ffDuration
        }
      }
      // If handler returned PCM directly (legacy), handle it
      if (result.buffer && result.buffer.byteLength > 0) {
        const u8 = result.buffer
        const numSamples = u8.byteLength / 4
        const channelData = new Float32Array(u8.buffer, u8.byteOffset, numSamples)
        const duration = realFileDurationSec ?? result.duration ?? channelData.length / (result.sampleRate ?? 44100)
        return {
          channelData,
          sampleRate: result.sampleRate ?? 44100,
          duration,
        }
      }
    } catch (e) {
      console.warn('[SongNhac] decodeAudioForTimeline failed (will use Web Audio fallback):', e)
    }
  }

  // Decode bằng Web Audio API (đọc bytes + decode)
  const bytes = await api.readAudioFile(path)
  if (bytes.byteLength > MAX_DECODE_BYTES) {
    const maxMb = (MAX_DECODE_BYTES / 1024 / 1024).toFixed(0)
    throw new Error(`File quá lớn (${(bytes.byteLength / 1024 / 1024).toFixed(0)} MB). Chọn file dưới ~${maxMb} MB.`)
  }
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const ctx = new AudioContext()
  try {
    const decoded = await ctx.decodeAudioData(arrayBuffer)
    const channelData = decoded.getChannelData(0)
    return {
      channelData,
      sampleRate: decoded.sampleRate,
      // Prefer ffprobe duration (more accurate for VBR) over Web Audio duration
      duration: realFileDurationSec ?? decoded.duration,
    }
  } finally {
    ctx.close()
  }
}
