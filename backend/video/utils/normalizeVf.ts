/**
 * normalizeVf.ts — Shared utility để build FFmpeg -vf filter
 * chuẩn hóa resolution (aspect ratio) + FPS.
 *
 * Được dùng bởi: mergeVideosSimple, cutSingleSimple, splitManySimple, normalizeVideo
 */

/**
 * Tỉ lệ khung hình phổ biến kèm resolution chuẩn.
 * Format value: 'WxH' — truyền thẳng vào buildNormalizeVfFilter.
 */
export const RESOLUTION_OPTIONS = [
  { label: '16:9 — 1920×1080 (Full HD Ngang)', value: '1920x1080' },
  { label: '4:3 — 1440×1080 (Cổ điển)', value: '1440x1080' },
  { label: '2.35:1 — 2560×1080 (Cinemascope)', value: '2560x1080' },
  { label: '2:1 — 2160×1080 (Univisium)', value: '2160x1080' },
  { label: '1.85:1 — 1998×1080 (Widescreen)', value: '1998x1080' },
  { label: '9:16 — 1080×1920 (Dọc / Reels / Shorts)', value: '1080x1920' },
  { label: '3:4 — 1080×1440 (Dọc cổ điển)', value: '1080x1440' },
  { label: '5.8-inch — 1080×1868 (Mobile tall)', value: '1080x1868' },
  { label: '1:1 — 1080×1080 (Vuông / Instagram)', value: '1080x1080' },
  { label: '16:9 — 3840×2160 (4K UHD)', value: '3840x2160' },
  { label: '16:9 — 1280×720 (HD 720p)', value: '1280x720' },
] as const

/**
 * Danh sách FPS phổ biến.
 * value: FFmpeg fps filter value string (hỗ trợ fraction 30000/1001 = 29.97fps)
 */
export const FPS_OPTIONS = [
  { label: '24.00 fps (Cinema)', value: '24' },
  { label: '25.00 fps (PAL / Europe)', value: '25' },
  { label: '29.97 fps (NTSC)', value: '30000/1001' },
  { label: '30.00 fps (YouTube phổ biến)', value: '30' },
  { label: '50.00 fps (PAL HFR)', value: '50' },
  { label: '59.94 fps (NTSC HFR)', value: '60000/1001' },
  { label: '60.00 fps (Gaming / HFR)', value: '60' },
] as const

interface NormalizeTargetSpec {
  evenW: number
  evenH: number
  safeFps: string
}

function resolveNormalizeTargetSpec(resolution: string, fps: string): NormalizeTargetSpec {
  const FPS_ALLOWLIST = new Set<string>(FPS_OPTIONS.map((o) => o.value))
  const safeFps = FPS_ALLOWLIST.has(fps) ? fps : '30'

  const [wStr, hStr] = resolution.split('x')
  const w = parseInt(wStr, 10)
  const h = parseInt(hStr, 10)
  const evenW = Math.floor(w / 2) * 2
  const evenH = Math.floor(h / 2) * 2

  if (!Number.isFinite(w) || !Number.isFinite(h) || evenW < 2 || evenH < 2) {
    return {
      evenW: 0,
      evenH: 0,
      safeFps,
    }
  }

  return {
    evenW,
    evenH,
    safeFps,
  }
}

/**
 * Build FFmpeg -vf filter để chuẩn hóa resolution + aspect ratio + FPS.
 *
 * Dùng scale với force_original_aspect_ratio=decrease + pad để
 * letterbox/pillarbox khi tỉ lệ khác nhau:
 * - Video 3:2 (1620×1080) → 16:9 (1920×1080): pillarbox (2 dải đen 2 bên)
 * - Video 9:16 (1080×1920) → 16:9 (1920×1080): letterbox (2 dải đen trên dưới)
 * - Video có FPS 24 → 30fps: interpolate với fps filter
 *
 * @param resolution - 'WxH' string, ví dụ '1920x1080'
 * @param fps - fps string, ví dụ '30', '30000/1001'
 * @returns FFmpeg -vf filter string
 */
export function buildNormalizeVfFilter(resolution: string, fps: string): string {
  const { evenW, evenH, safeFps } = resolveNormalizeTargetSpec(resolution, fps)

  if (evenW < 2 || evenH < 2) {
    return `scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,fps=${safeFps},format=yuv420p`
  }

  const scaleFilter = `scale=${evenW}:${evenH}:force_original_aspect_ratio=decrease:flags=lanczos`
  const padFilter = `pad=${evenW}:${evenH}:(ow-iw)/2:(oh-ih)/2:black`
  const sarFilter = `setsar=1`
  const fpsFilter = `fps=${safeFps}`
  const formatFilter = `format=yuv420p`

  return `${scaleFilter},${padFilter},${sarFilter},${fpsFilter},${formatFilter}`
}

/**
 * Build hybrid CUDA normalize filter cho Pass 1 của Final Export.
 *
 * Mục tiêu của path này là offload phần scale nặng sang GPU bằng scale_cuda,
 * sau đó hwdownload về CPU để pad/fps/format vẫn đi theo path an toàn hiện có.
 *
 * Điều này KHÔNG phải full-GPU filter graph — pad/fps vẫn chạy trên CPU để giữ
 * tính tương thích và giảm nguy cơ crash so với việc trộn hwaccel decode + filter.
 */
export function buildNormalizeCudaHybridVfFilter(resolution: string, fps: string): string {
  const { evenW, evenH, safeFps } = resolveNormalizeTargetSpec(resolution, fps)

  if (evenW < 2 || evenH < 2) {
    return [
      'format=nv12',
      'hwupload_cuda',
      "scale_cuda=w='trunc(iw/2)*2':h='trunc(ih/2)*2'",
      'hwdownload',
      'format=nv12',
      'setsar=1',
      `fps=${safeFps}`,
      'format=yuv420p',
    ].join(',')
  }

  const targetAspectExpr = `${evenW}/${evenH}`
  const scaleWidthExpr = `if(gte(iw/ih,${targetAspectExpr}),${evenW},trunc(${evenH}*(iw/ih)/2)*2)`
  const scaleHeightExpr = `if(gte(iw/ih,${targetAspectExpr}),trunc(${evenW}/(iw/ih)/2)*2,${evenH})`

  return [
    'format=nv12',
    'hwupload_cuda',
    `scale_cuda=w='${scaleWidthExpr}':h='${scaleHeightExpr}'`,
    'hwdownload',
    'format=nv12',
    `pad=${evenW}:${evenH}:(ow-iw)/2:(oh-ih)/2:black`,
    'setsar=1',
    `fps=${safeFps}`,
    'format=yuv420p',
  ].join(',')
}
