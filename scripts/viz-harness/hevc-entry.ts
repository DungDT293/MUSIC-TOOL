import { FrameEncoder } from '../../src/features/song-nhac/export/frameEncoder'

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

;(window as unknown as Record<string, unknown>).encodeHevcTest = async (width = 320, height = 180, frameCount = 30) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')

  const chunks: Uint8Array[] = []
  const encoder = new FrameEncoder({
    width,
    height,
    fps: 30,
    bitrate: 2_000_000,
    codec: 'hevc',
    onChunk: (chunk) => chunks.push(chunk),
  })
  const ready = await encoder.init()
  if (!ready) return { ok: false, error: 'encoder init failed' }

  for (let i = 0; i < frameCount; i += 1) {
    ctx.fillStyle = `hsl(${(i * 12) % 360} 80% 50%)`
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = '#ffffff'
    ctx.font = '48px sans-serif'
    ctx.fillText(String(i), 20, 110)
    encoder.encode(canvas, i, i === 0)
  }
  await encoder.flush()
  const selected = encoder.selectedCodec
  encoder.close()

  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, codec: selected, bytes: merged.byteLength, base64: toBase64(merged) }
}
