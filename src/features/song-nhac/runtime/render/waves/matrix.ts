/**
 * Wave Style: Ma trận (matrix)
 * Icon: 🟩
 * Category: tech
 *
 * V2: Multi-depth layers, CRT scan line, column grouping by frequency band,
 *     beat "awakening" flash, improved head glow.
 * V2.1: Fix Math.random() → deterministicRandom() for export determinism.
 */

import { type FrequencyBands, type VisualizerColorOptions, getSpectrumAt, animTimeMs, resolveColorRgba, deterministicRandom } from './helpers'
import { registerWave, registerWaveCleanup } from './registry'

interface MatrixColumn {
  x: number
  y: number
  speed: number
  chars: string[]
  length: number
  hue: number
  depth: number  // 0 = front, 1 = back
}

let matrixColumns: MatrixColumn[] | null = null
const MATRIX_COL_COUNT = 40
const MATRIX_CHARS = '0123456789ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏｹﾒｴｶｷﾑﾕﾗｾﾈｽﾀﾇﾍABCDEFZYXWV'

function ensureMatrixColumns(): MatrixColumn[] {
  if (matrixColumns && matrixColumns.length === MATRIX_COL_COUNT) return matrixColumns
  matrixColumns = []
  for (let i = 0; i < MATRIX_COL_COUNT; i++) {
    const len = 6 + Math.floor(deterministicRandom(i * 73.1 + 17) * 12)
    const chars: string[] = []
    for (let j = 0; j < len; j++) {
      chars.push(MATRIX_CHARS[Math.floor(deterministicRandom(i * 37 + j * 91.3) * MATRIX_CHARS.length)]!)
    }
    const depthRand = deterministicRandom(i * 53.7 + 11)
    const depth = depthRand < 0.3 ? 0.7 + deterministicRandom(i * 67.1) * 0.3
      : depthRand < 0.7 ? 0.3 + deterministicRandom(i * 83.3) * 0.4
      : deterministicRandom(i * 97.7) * 0.3
    matrixColumns.push({
      x: (i / MATRIX_COL_COUNT) - 0.5 + (deterministicRandom(i * 41.9) - 0.5) * 0.02,
      y: deterministicRandom(i * 29.3) - 0.5,
      speed: 0.0005 + deterministicRandom(i * 61.7) * 0.001,
      chars,
      length: len,
      hue: deterministicRandom(i * 47.3),
      depth,
    })
  }
  matrixColumns.sort((a, b) => b.depth - a.depth)
  return matrixColumns
}

function drawWaveMatrix(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  amplitude: number,
  samples: number[],
  spectrum?: number[],
  bands?: FrequencyBands,
  vc?: VisualizerColorOptions,
  beat?: number
): void {
  if (samples.length < 4) return
  const size = Math.max(w, h)
  const spd = vc?.speed ?? 1
  const time = animTimeMs() * 0.001 * spd
  const shift = (time * 0.02) % 1
  const bassE = bands?.bass ?? 0.3
  const midE = bands?.mid ?? 0.3
  const beatVal = beat ?? 0

  const columns = ensureMatrixColumns()

  ctx.save()

  for (let c = 0; c < columns.length; c++) {
    const col = columns[c]!
    const specVal = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, c * 2, MATRIX_COL_COUNT * 2) : 0.3

    const depthScale = 1 - col.depth * 0.4
    const depthAlpha = 1 - col.depth * 0.6

    const colPos = (col.x + 0.5)
    const bandBoost = colPos < 0.33 ? bassE : colPos < 0.66 ? midE : (bands?.treble ?? 0.2)

    col.y += col.speed * spd * (1 + specVal * 1.5 + beatVal * 0.5 + bandBoost * 0.3)
    if (col.y > 0.6) {
      col.y = -0.6
      // Deterministic reset based on time + column index
      const resetSeed = time * 7.3 + c * 131.7
      col.hue = deterministicRandom(resetSeed)
      for (let j = 0; j < col.length; j++) {
        if (deterministicRandom(resetSeed + j * 49.3) > 0.5) {
          col.chars[j] = MATRIX_CHARS[Math.floor(deterministicRandom(resetSeed + j * 71.1) * MATRIX_CHARS.length)]!
        }
      }
    }

    const cx = col.x * w
    const charSize = size * 0.012 * depthScale
    const charSpacing = charSize * 1.2
    ctx.font = `${charSize}px monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    for (let j = 0; j < col.length; j++) {
      const cy = (col.y * h) - j * charSpacing
      if (cy < -h / 2 - charSize || cy > h / 2 + charSize) continue

      const trailFade = 1 - j / col.length
      const alpha = trailFade * (0.3 + specVal * 0.5 + (j === 0 ? 0.3 : 0)) * depthAlpha

      if (j === 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, (alpha + beatVal * 0.3) * depthAlpha)})`
        const glowR = charSize * 1.5
        const headGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR)
        headGrad.addColorStop(0, resolveColorRgba(shift + col.hue, 0.15 * depthAlpha, vc))
        headGrad.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.save()
        ctx.fillStyle = headGrad
        ctx.fillRect(cx - glowR, cy - glowR, glowR * 2, glowR * 2)
        ctx.restore()
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, (alpha + beatVal * 0.3) * depthAlpha)})`
      } else {
        ctx.fillStyle = resolveColorRgba(shift + col.hue, alpha, vc)
      }

      // Deterministic char flickering based on time + position
      const flickerSeed = time * 17.3 + c * 7.1 + j * 3.7
      if (deterministicRandom(flickerSeed) > 0.97) {
        col.chars[j] = MATRIX_CHARS[Math.floor(deterministicRandom(flickerSeed + 100) * MATRIX_CHARS.length)]!
      }

      ctx.fillText(col.chars[j]!, cx, cy)
    }
  }

  // CRT scan line
  const scanY = ((time * 0.5) % 1.2 - 0.1) * h - h / 2
  const scanGrad = ctx.createLinearGradient(0, scanY - size * 0.02, 0, scanY + size * 0.02)
  scanGrad.addColorStop(0, 'rgba(255,255,255,0)')
  scanGrad.addColorStop(0.5, `rgba(255,255,255,${0.03 + beatVal * 0.02})`)
  scanGrad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = scanGrad
  ctx.fillRect(-w / 2, scanY - size * 0.02, w, size * 0.04)

  // Beat flash
  if (beatVal > 0.4) {
    ctx.fillStyle = resolveColorRgba(shift, (beatVal - 0.4) * 0.06, vc)
    ctx.fillRect(-w / 2, -h / 2, w, h)
  }

  ctx.restore()
}

// ═══ Registration ═══
registerWave('matrix', drawWaveMatrix, {
  id: 'matrix',
  label: 'Ma trận',
  icon: '🟩',
  category: 'tech',
})
registerWaveCleanup(() => { matrixColumns = null })
