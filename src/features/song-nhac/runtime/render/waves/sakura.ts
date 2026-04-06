/**
 * Wave Style: Hoa anh dao (sakura)
 * Icon: 🌸
 * Category: nature
 *
 * Canh hoa anh dao roi nhe nhang voi sway, rotation, beat push-up.
 */

import { type FrequencyBands, type VisualizerColorOptions, animTimeMs, resolveColorRgba, deterministicRandom } from './helpers'
import { registerWave, registerWaveCleanup } from './registry'

interface SakuraPetal {
  x: number       // -0.5..0.5 normalised
  y: number       // -0.6..0.6 normalised
  size: number    // normalised radius
  rotation: number // current rotation (radians)
  rotSpeed: number // rotation speed
  swayPhase: number
  swayAmp: number
  fallSpeed: number
  hue: number     // 0..1 pink variation
  alpha: number
}

let petalPool: SakuraPetal[] | null = null
const PETAL_COUNT = 30

function ensurePetals(): SakuraPetal[] {
  if (petalPool && petalPool.length === PETAL_COUNT) return petalPool
  petalPool = []
  for (let i = 0; i < PETAL_COUNT; i++) {
    petalPool.push({
      x: (deterministicRandom(i * 73.1 + 1) - 0.5) * 1.2,
      y: -0.6 + deterministicRandom(i * 73.1 + 2) * 1.2,
      size: 0.006 + deterministicRandom(i * 73.1 + 3) * 0.008,
      rotation: deterministicRandom(i * 73.1 + 4) * Math.PI * 2,
      rotSpeed: (deterministicRandom(i * 73.1 + 5) - 0.5) * 1.5,
      swayPhase: deterministicRandom(i * 73.1 + 6) * Math.PI * 2,
      swayAmp: 0.0001 + deterministicRandom(i * 73.1 + 7) * 0.0003,
      fallSpeed: 0.0003 + deterministicRandom(i * 73.1 + 8) * 0.0005,
      hue: deterministicRandom(i * 73.1 + 9),
      alpha: 0.4 + deterministicRandom(i * 73.1 + 10) * 0.4,
    })
  }
  return petalPool
}

/** Draw a single cherry blossom petal shape (oval with pointed tip) */
function drawPetal(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath()
  // Teardrop/oval shape
  ctx.moveTo(0, -r)
  ctx.bezierCurveTo(r * 0.8, -r * 0.6, r * 0.9, r * 0.3, 0, r)
  ctx.bezierCurveTo(-r * 0.9, r * 0.3, -r * 0.8, -r * 0.6, 0, -r)
  ctx.closePath()
}

/** Sakura pink palette */
function sakuraColor(hue: number, alpha: number): string {
  // hue 0 = light pink (#ffb7c5), 1 = deeper pink (#ff69b4)
  const r = 255
  const g = Math.round(183 - hue * 78)   // 183 → 105
  const b = Math.round(197 - hue * 17)   // 197 → 180
  return `rgba(${r},${g},${b},${alpha})`
}

function drawWaveSakura(
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

  const petals = ensurePetals()
  const useVc = vc?.colorMode && vc.colorMode !== 'rainbow'

  ctx.save()

  // Ambient pink glow when many petals are visible
  if (midE > 0.2) {
    const ambR = size * 0.2
    const ambGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, ambR)
    ambGrad.addColorStop(0, useVc
      ? resolveColorRgba(shift, midE * 0.03, vc)
      : sakuraColor(0.3, midE * 0.03))
    ambGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = ambGrad
    ctx.beginPath()
    ctx.arc(0, 0, ambR, 0, Math.PI * 2)
    ctx.fill()
  }

  for (let i = 0; i < petals.length; i++) {
    const p = petals[i]!

    // Sway horizontally with sine wave
    const sway = Math.sin(time * 1.2 + p.swayPhase) * p.swayAmp * spd
    p.x += sway

    // Fall downward
    p.y += p.fallSpeed * spd

    // Beat pushes petals upward briefly
    if (beatVal > 0.4) {
      p.y -= beatVal * 0.002 * spd
    }

    // Rotation while falling
    p.rotation += p.rotSpeed * 0.02 * spd

    // Wrap: respawn at top when falling off bottom
    if (p.y > 0.65) {
      p.y = -0.65
      p.x = (deterministicRandom(animTimeMs() * 0.1 + i * 47.3) - 0.5) * 1.2
      p.hue = deterministicRandom(animTimeMs() * 0.1 + i * 47.3 + 11)
      p.size = 0.006 + deterministicRandom(animTimeMs() * 0.1 + i * 47.3 + 23) * 0.008
    }
    // Horizontal wrap
    if (p.x < -0.65) p.x = 0.65
    if (p.x > 0.65) p.x = -0.65

    const px = p.x * w
    const py = p.y * h
    const pr = p.size * size * (0.7 + bassE * 0.3)

    // Depth illusion: use rotation to scale petal (simulate 3D flip)
    const depthScale = 0.5 + 0.5 * Math.abs(Math.cos(p.rotation * 0.7))
    const drawR = pr * depthScale

    if (drawR < 0.5) continue // too small to see

    const pAlpha = p.alpha * (0.5 + midE * 0.3 + beatVal * 0.15)

    ctx.save()
    ctx.translate(px, py)
    ctx.rotate(p.rotation)
    ctx.scale(1, depthScale) // flatten for depth effect

    // Petal glow (soft halo behind)
    const glowR = drawR * 2.5
    const glowGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, glowR)
    glowGrad.addColorStop(0, useVc
      ? resolveColorRgba(shift + p.hue * 0.3, pAlpha * 0.15, vc)
      : sakuraColor(p.hue, pAlpha * 0.15))
    glowGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = glowGrad
    ctx.beginPath()
    ctx.arc(0, 0, glowR, 0, Math.PI * 2)
    ctx.fill()

    // Petal body
    drawPetal(ctx, drawR)
    ctx.fillStyle = useVc
      ? resolveColorRgba(shift + p.hue * 0.3, pAlpha * 0.6, vc)
      : sakuraColor(p.hue, pAlpha * 0.6)
    ctx.fill()

    // Petal edge highlight
    drawPetal(ctx, drawR)
    ctx.strokeStyle = useVc
      ? resolveColorRgba(shift + p.hue * 0.3, pAlpha * 0.3, vc)
      : sakuraColor(p.hue, pAlpha * 0.3)
    ctx.lineWidth = drawR * 0.08
    ctx.stroke()

    // Center vein (subtle line)
    ctx.strokeStyle = `rgba(255, 200, 210, ${pAlpha * 0.2})`
    ctx.lineWidth = drawR * 0.04
    ctx.beginPath()
    ctx.moveTo(0, -drawR * 0.7)
    ctx.lineTo(0, drawR * 0.7)
    ctx.stroke()

    ctx.restore()
  }

  // Swirl of tiny petal fragments on strong beat
  if (beatVal > 0.5) {
    const fragCount = Math.floor((beatVal - 0.5) * 16)
    for (let i = 0; i < fragCount; i++) {
      const angle = (i / fragCount) * Math.PI * 2 + time * 4
      const dist = size * 0.03 * (0.3 + deterministicRandom(animTimeMs() * 3 + i * 49.7) * 0.7) * beatVal
      const fx = Math.cos(angle) * dist
      const fy = Math.sin(angle) * dist
      const fr = size * 0.002 * beatVal
      ctx.fillStyle = useVc
        ? resolveColorRgba(shift + i * 0.05, (beatVal - 0.5) * 0.8, vc)
        : sakuraColor(deterministicRandom(animTimeMs() * 3 + i * 49.7 + 13), (beatVal - 0.5) * 0.8)
      ctx.beginPath()
      ctx.arc(fx, fy, fr, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  ctx.restore()
}

registerWave('sakura', drawWaveSakura, {
  id: 'sakura',
  label: 'Hoa anh đào',
  icon: '🌸',
  category: 'nature',
})
registerWaveCleanup(() => { petalPool = null })
