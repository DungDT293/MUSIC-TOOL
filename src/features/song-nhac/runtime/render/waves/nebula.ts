/**
 * Wave Style: Tinh vân (nebula)
 * Icon: ✨
 * Category: nature
 *
 * V2: dust lanes, shooting stars, enhanced supernova pulse, color clouds
 */

import { type FrequencyBands, type VisualizerColorOptions, getMaxOffset, getSampleAt, getSpectrumAt, animTimeMs, WAVE_SEGMENTS, applyGlow, clearGlow, deterministicRandom } from './helpers'
import { registerWave, registerWaveCleanup } from './registry'

// Persistent shooting star state
interface ShootingStar {
  angle: number
  startR: number
  speed: number
  life: number
  maxLife: number
  hue: number
}
let shootingStars: ShootingStar[] = []
let lastShootingStarTime = 0

function drawWaveNebula(
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
  const baseR = Math.sqrt(w * w + h * h) / 2
  const maxOff = getMaxOffset(w, h) * amplitude * 1.4
  const spd = vc?.speed ?? 1
  const time = animTimeMs() * 0.001 * spd
  const shift = (time * 0.012) % 1
  const bassE = bands?.bass ?? 0.5
  const midE = bands?.mid ?? 0.3
  const trebleE = bands?.treble ?? 0.2
  const beatVal = beat ?? 0

  const nebulaColors: [number, number, number][] = [
    [80, 20, 150], [20, 80, 160], [0, 140, 130], [200, 60, 120], [40, 40, 180],
  ]

  function nebulaColor(t: number, alpha: number): string {
    const ct = ((t % 1) + 1) % 1
    const s = ct * (nebulaColors.length - 1)
    const i = Math.min(Math.floor(s), nebulaColors.length - 2)
    const f = s - i
    const a = nebulaColors[i]!
    const b = nebulaColors[i + 1]!
    return `rgba(${a[0] + (b[0] - a[0]) * f | 0},${a[1] + (b[1] - a[1]) * f | 0},${a[2] + (b[2] - a[2]) * f | 0},${alpha})`
  }

  ctx.save()

  const armCount = 4
  const dotsPerArm = 35
  const rot = time * 0.3

  for (let arm = 0; arm < armCount; arm++) {
    const armOff = (arm / armCount) * Math.PI * 2
    const armShift = (shift + arm / armCount) % 1

    // Build spiral arm points
    const pts: { x: number; y: number; t: number; r: number }[] = []
    for (let i = 0; i < dotsPerArm; i++) {
      const progress = i / dotsPerArm
      const specIdx = Math.floor(progress * 63)
      const rawT = spectrum && spectrum.length > 0
        ? getSpectrumAt(spectrum, specIdx, 64)
        : getSampleAt(samples, Math.floor(progress * WAVE_SEGMENTS))
      const t = Math.pow(rawT, 1.1)
      const angle = armOff + progress * Math.PI * 3 + rot
      const spiralR = baseR + progress * maxOff * (0.25 + t * 0.75)
      pts.push({ x: Math.cos(angle) * spiralR, y: Math.sin(angle) * spiralR, t, r: spiralR })
    }

    // V2: Dust lanes — dark patches between arms for contrast
    if (arm < 2) {
      const dustAngle = armOff + Math.PI / armCount + rot
      for (let d = 0; d < 5; d++) {
        const dProgress = 0.2 + d * 0.15
        const dR = baseR + dProgress * maxOff * 0.6
        const dx = Math.cos(dustAngle + d * 0.25) * dR
        const dy = Math.sin(dustAngle + d * 0.25) * dR
        const dustSize = size * 0.04 * (0.6 + d * 0.1)
        const dustGrad = ctx.createRadialGradient(dx, dy, 0, dx, dy, dustSize)
        dustGrad.addColorStop(0, `rgba(5, 3, 15, ${0.06 + bassE * 0.03})`)
        dustGrad.addColorStop(0.6, 'rgba(5, 3, 15, 0.03)')
        dustGrad.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = dustGrad
        ctx.beginPath()
        ctx.arc(dx, dy, dustSize, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Nebula clouds
    for (let i = 0; i < pts.length; i += 3) {
      const p = pts[i]!
      if (p.t < 0.05) continue
      const cloudR = size * 0.03 * (0.5 + p.t) * (1 + bassE * 0.5)
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, cloudR)
      grad.addColorStop(0, nebulaColor(armShift + i * 0.02, 0.15 * p.t))
      grad.addColorStop(0.5, nebulaColor(armShift + i * 0.02 + 0.1, 0.06 * p.t))
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(p.x, p.y, cloudR, 0, Math.PI * 2)
      ctx.fill()
    }

    // V2: Color clouds — larger soft patches between arms
    if (arm % 2 === 0) {
      const cloudAngle = armOff + 0.5 + rot * 0.7
      const cloudDist = baseR * 0.7
      const cx = Math.cos(cloudAngle) * cloudDist
      const cy = Math.sin(cloudAngle) * cloudDist
      const cSize = size * 0.08 * (0.6 + midE * 0.4)
      const cGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cSize)
      cGrad.addColorStop(0, nebulaColor(armShift + 0.3, 0.05 + midE * 0.03))
      cGrad.addColorStop(0.4, nebulaColor(armShift + 0.5, 0.02))
      cGrad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = cGrad
      ctx.beginPath()
      ctx.arc(cx, cy, cSize, 0, Math.PI * 2)
      ctx.fill()
    }

    // Trail line (glowing)
    ctx.beginPath()
    ctx.moveTo(pts[0]!.x, pts[0]!.y)
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1]!
      const curr = pts[i]!
      ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + curr.x) / 2, (prev.y + curr.y) / 2)
    }
    ctx.strokeStyle = nebulaColor(armShift, 0.3)
    ctx.lineWidth = size * 0.005
    if (vc?.glowEnabled) applyGlow(ctx, armShift, vc, beatVal)
    ctx.stroke()
    if (vc?.glowEnabled) clearGlow(ctx)

    // Bright core trail
    ctx.beginPath()
    ctx.moveTo(pts[0]!.x, pts[0]!.y)
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1]!
      const curr = pts[i]!
      ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + curr.x) / 2, (prev.y + curr.y) / 2)
    }
    ctx.strokeStyle = nebulaColor(armShift, 0.6)
    ctx.lineWidth = size * 0.0015
    ctx.stroke()

    // Star particles
    for (let i = 0; i < pts.length; i += 3) {
      const p = pts[i]!
      if (p.t < 0.25) continue
      const dotR = size * 0.003 * p.t * (0.7 + Math.sin(i * 1.3 + time * 2) * 0.3)
      ctx.fillStyle = nebulaColor(armShift + i * 0.03, 0.15 * p.t)
      ctx.beginPath()
      ctx.arc(p.x, p.y, dotR * 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = `rgba(255, 255, 255, ${0.4 + p.t * 0.5})`
      ctx.beginPath()
      ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2)
      ctx.fill()
    }

    // Stardust trail
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'
    ctx.beginPath()
    for (let i = 0; i < pts.length - 1; i += 2) {
      const p1 = pts[i]!
      const p2 = pts[i + 1]!
      if (p1.t < 0.15 && p2.t < 0.15) continue
      const jx = (p1.x + p2.x) / 2 + Math.sin(time * 5 + i * 2.7) * size * 0.003
      const jy = (p1.y + p2.y) / 2 + Math.cos(time * 4 + i * 1.9) * size * 0.003
      const dr = size * 0.0012 * (p1.t + p2.t) / 2
      ctx.moveTo(jx + dr, jy)
      ctx.arc(jx, jy, dr, 0, Math.PI * 2)
    }
    ctx.fill()
  }

  // ═══ V2: Shooting stars — triggered by treble ═══
  const now = time * 1000
  if (trebleE > 0.4 && now - lastShootingStarTime > 300) {
    lastShootingStarTime = now
    shootingStars.push({
      angle: deterministicRandom(animTimeMs() * 0.1 + shootingStars.length * 73.1) * Math.PI * 2,
      startR: baseR * 0.5 + deterministicRandom(animTimeMs() * 0.1 + shootingStars.length * 73.1 + 11) * baseR * 0.6,
      speed: size * 0.003 + deterministicRandom(animTimeMs() * 0.1 + shootingStars.length * 73.1 + 23) * size * 0.004,
      life: 1,
      maxLife: 0.4 + deterministicRandom(animTimeMs() * 0.1 + shootingStars.length * 73.1 + 37) * 0.3,
      hue: deterministicRandom(animTimeMs() * 0.1 + shootingStars.length * 73.1 + 53),
    })
    if (shootingStars.length > 5) shootingStars.shift()
  }
  const dt = 1 / 60 * spd
  for (let i = shootingStars.length - 1; i >= 0; i--) {
    const star = shootingStars[i]!
    star.life -= dt / star.maxLife
    if (star.life <= 0) { shootingStars.splice(i, 1); continue }
    const tailLen = size * 0.04 * star.life
    const sx = Math.cos(star.angle) * star.startR
    const sy = Math.sin(star.angle) * star.startR
    const ex = sx + Math.cos(star.angle + 0.5) * tailLen
    const ey = sy + Math.sin(star.angle + 0.5) * tailLen
    const sg = ctx.createLinearGradient(sx, sy, ex, ey)
    sg.addColorStop(0, `rgba(255,255,255,${star.life * 0.8})`)
    sg.addColorStop(0.3, nebulaColor(star.hue, star.life * 0.5))
    sg.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.strokeStyle = sg
    ctx.lineWidth = size * 0.002 * star.life
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.lineTo(ex, ey)
    ctx.stroke()
    star.startR += star.speed * spd
  }

  // ═══ Central supernova glow (enhanced) ═══
  const glowR = baseR + bassE * maxOff * 0.35
  if (bassE > 0.15) {
    const outerGlowR = glowR * 1.5
    const outerGrad = ctx.createRadialGradient(0, 0, glowR * 0.3, 0, 0, outerGlowR)
    outerGrad.addColorStop(0, nebulaColor(shift + 0.5, bassE * 0.06))
    outerGrad.addColorStop(0.5, nebulaColor(shift + 0.7, bassE * 0.03))
    outerGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = outerGrad
    ctx.beginPath()
    ctx.arc(0, 0, outerGlowR, 0, Math.PI * 2)
    ctx.fill()
  }
  if (bassE > 0.2) {
    const pulseScale = 1 + beatVal * 0.3
    const coreR = glowR * pulseScale
    const centerGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR)
    centerGrad.addColorStop(0, nebulaColor(shift, bassE * 0.18))
    centerGrad.addColorStop(0.3, nebulaColor(shift + 0.2, bassE * 0.1))
    centerGrad.addColorStop(0.6, nebulaColor(shift + 0.5, bassE * 0.03))
    centerGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = centerGrad
    ctx.beginPath()
    ctx.arc(0, 0, coreR, 0, Math.PI * 2)
    ctx.fill()
  }
  if (bassE > 0.65) {
    const flashR = glowR * 0.7
    const flashAlpha = (bassE - 0.65) * 2.5
    const flashGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, flashR)
    flashGrad.addColorStop(0, `rgba(255, 255, 255, ${flashAlpha * 0.35})`)
    flashGrad.addColorStop(0.4, nebulaColor(shift, flashAlpha * 0.15))
    flashGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = flashGrad
    ctx.beginPath()
    ctx.arc(0, 0, flashR, 0, Math.PI * 2)
    ctx.fill()
  }

  // Orbiting pulsar
  const orbitR = baseR * 1.1
  const orbitAngle = time * 0.6
  const starX = Math.cos(orbitAngle) * orbitR
  const starY = Math.sin(orbitAngle) * orbitR
  const starSize = size * 0.008 * (0.6 + bassE * 0.8)
  const starGrad = ctx.createRadialGradient(starX, starY, 0, starX, starY, starSize * 3)
  starGrad.addColorStop(0, 'rgba(255, 255, 255, 0.7)')
  starGrad.addColorStop(0.3, nebulaColor(shift, 0.4))
  starGrad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = starGrad
  ctx.beginPath()
  ctx.arc(starX, starY, starSize * 3, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.beginPath()
  ctx.arc(starX, starY, starSize * 0.5, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

registerWave('nebula', drawWaveNebula, {
  id: 'nebula',
  label: 'Tinh vân',
  icon: '✨',
  category: 'nature',
})
registerWaveCleanup(() => {
  shootingStars = []
  lastShootingStarTime = 0
})
