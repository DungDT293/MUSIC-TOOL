/**
 * Built-in stock backgrounds.
 *
 * They are generated as SVG data URLs instead of shipping binary assets: no download,
 * no licence questions, and they scale to 4K without banding. Add new entries here and
 * they show up in the Media panel automatically.
 */
export interface StockItem {
  id: string
  name: string
  kind: 'image'
  dataUrl: string
}

const svg = (body: string) => {
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">${body}</svg>`
  // Base64 keeps `url(#gradient)` references intact; a percent-encoded `#` breaks them.
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(markup)))}`
}

const radial = (stops: string) =>
  svg(
    `<defs><radialGradient id="g" cx="50%" cy="45%" r="70%">${stops}</radialGradient></defs>` +
      `<rect width="1920" height="1080" fill="url(#g)"/>`,
  )

const linear = (stops: string, angle = 135) =>
  svg(
    `<defs><linearGradient id="g" gradientTransform="rotate(${angle} 0.5 0.5)">${stops}</linearGradient></defs>` +
      `<rect width="1920" height="1080" fill="url(#g)"/>`,
  )

const bloom = (color: string, cx: number, cy: number, r: number) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="0.55" filter="url(#b)"/>`

export const STOCK_ITEMS: StockItem[] = [
  {
    id: 'stock-night',
    name: 'Đêm xanh',
    kind: 'image',
    dataUrl: radial(
      '<stop offset="0%" stop-color="#1e3a8a"/><stop offset="55%" stop-color="#0b1220"/><stop offset="100%" stop-color="#020617"/>',
    ),
  },
  {
    id: 'stock-sunset',
    name: 'Hoàng hôn',
    kind: 'image',
    dataUrl: linear(
      '<stop offset="0%" stop-color="#f97316"/><stop offset="50%" stop-color="#db2777"/><stop offset="100%" stop-color="#4c1d95"/>',
      160,
    ),
  },
  {
    id: 'stock-forest',
    name: 'Rừng sâu',
    kind: 'image',
    dataUrl: linear(
      '<stop offset="0%" stop-color="#052e16"/><stop offset="45%" stop-color="#166534"/><stop offset="100%" stop-color="#020617"/>',
      100,
    ),
  },
  {
    id: 'stock-ocean',
    name: 'Đại dương',
    kind: 'image',
    dataUrl: linear(
      '<stop offset="0%" stop-color="#082f49"/><stop offset="50%" stop-color="#0ea5e9"/><stop offset="100%" stop-color="#0f172a"/>',
      200,
    ),
  },
  {
    id: 'stock-neon-grid',
    name: 'Lưới neon',
    kind: 'image',
    dataUrl: svg(
      '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#0b1220"/><stop offset="100%" stop-color="#111827"/></linearGradient>' +
        '<pattern id="p" width="96" height="96" patternUnits="userSpaceOnUse">' +
        '<path d="M96 0H0V96" fill="none" stroke="#22d3ee" stroke-opacity="0.35" stroke-width="2"/></pattern></defs>' +
        '<rect width="1920" height="1080" fill="url(#g)"/><rect width="1920" height="1080" fill="url(#p)"/>',
    ),
  },
  {
    id: 'stock-bokeh',
    name: 'Bokeh',
    kind: 'image',
    dataUrl: svg(
      '<defs><filter id="b"><feGaussianBlur stdDeviation="26"/></filter>' +
        '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0%" stop-color="#1e1b4b"/><stop offset="100%" stop-color="#4a044e"/></linearGradient></defs>' +
        '<rect width="1920" height="1080" fill="url(#g)"/>' +
        bloom('#f472b6', 380, 300, 120) +
        bloom('#22d3ee', 900, 520, 90) +
        bloom('#facc15', 1400, 260, 70) +
        bloom('#a855f7', 1620, 720, 140) +
        bloom('#38bdf8', 640, 820, 60),
    ),
  },
  {
    id: 'stock-halftone',
    name: 'Halftone',
    kind: 'image',
    dataUrl: svg(
      '<defs><pattern id="p" width="26" height="26" patternUnits="userSpaceOnUse">' +
        '<circle cx="6" cy="6" r="4" fill="#e2e8f0" fill-opacity="0.25"/></pattern></defs>' +
        '<rect width="1920" height="1080" fill="#0f172a"/><rect width="1920" height="1080" fill="url(#p)"/>',
    ),
  },
  {
    id: 'stock-vignette',
    name: 'Tối góc',
    kind: 'image',
    dataUrl: svg(
      '<defs><radialGradient id="g" cx="50%" cy="50%" r="65%">' +
        '<stop offset="0%" stop-color="#334155"/><stop offset="100%" stop-color="#020617"/></radialGradient></defs>' +
        '<rect width="1920" height="1080" fill="url(#g)"/>',
    ),
  },
]
