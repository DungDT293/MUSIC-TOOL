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
  const [wStr, hStr] = resolution.split('x')
  const w = parseInt(wStr, 10)
  const h = parseInt(hStr, 10)

  // Fallback nếu parse không thành công
  if (!w || !h) return `scale=iw:ih,setsar=1,fps=${fps}`

  // scale: giữ tỉ lệ gốc, fit vào WxH (không cắt), dùng lanczos cho chất lượng cao
  // scale lần 2 trunc(ow/2)*2:trunc(oh/2)*2 đảm bảo dimension chẵn — bắt buộc cho libx264/h264_nvenc
  const scaleFilter = `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,scale=trunc(ow/2)*2:trunc(oh/2)*2`
  // pad: thêm dải đen để đủ kích thước target (letterbox/pillarbox), căn giữa
  const padFilter = `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`
  // setsar=1: đảm bảo pixel aspect ratio = 1:1 (quan trọng cho compatibility)
  const sarFilter = `setsar=1`
  // fps: chuẩn hóa frame rate
  const fpsFilter = `fps=${fps}`

  // format=yuv420p: đảm bảo pixel format tương thích mọi encoder (GPU & CPU)
  // Phải đặt SAU fps filter để tránh color space mismatch
  const formatFilter = `format=yuv420p`

  return `${scaleFilter},${padFilter},${sarFilter},${fpsFilter},${formatFilter}`
}
