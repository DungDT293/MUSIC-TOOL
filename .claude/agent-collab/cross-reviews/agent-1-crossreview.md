# Agent 1 — Cross-Review

## Agent 2 waves reviewed:

### plasma.ts
- ✅ Tốt: Proper `ctx.save()/restore()` pairing. Beat breathing and expansion effects are well-implemented. Plasma cells between rings add good visual depth.
- ✅ Tốt: Uses `smoothPath()` for organic ring shapes. Good use of `resolveConicGrad` for rainbow-aware gradients.
- ⚠️ Cảnh báo: Line 91 — `ctx.globalAlpha = 0.6` set for plasma cells section, reset to 1.0 at line 115. This is correct but fragile — if an early return or exception occurs between these lines, `globalAlpha` will leak. Consider using a nested `ctx.save()/restore()` pair instead.
- ✅ Tốt: Registration meta correct: id='plasma', label='Plasma', icon='🌀', category='geometric'.
- ✅ Tốt: No persistent state, no `registerWaveCleanup` needed — correct.

### lightning.ts
- ✅ Tốt: Excellent deterministic pseudo-random via `rng()` function (line 32-35). This ensures consistent rendering across frames and is safe for export/recording.
- ✅ Tốt: Bolt branching logic (line 88-109) is well-structured — only branches for strong bolts (t > 0.5), limited to 1 sub-branch.
- ✅ Tốt: Beat flash overlay (line 42-46) capped at 0.12 alpha — subtle, not overwhelming.
- ✅ Tốt: Thunder afterglow at bolt base adds nice depth effect. Good `ctx.save()/restore()` pairing.
- ✅ Tốt: Registration meta correct: id='lightning', label='Sét', icon='⚡', category='nature'.
- 💡 Đề xuất: Line 29 `const seed = Math.floor(animTimeMs() / (80 / spd))` — the bolt pattern changes every ~80ms. Consider making this configurable or slightly randomizing the interval for more organic feel.

### galaxy.ts
- ✅ Tốt: 3-arm spiral structure with deterministic twinkling stars (seed-based positioning). Good approach for export consistency.
- ✅ Tốt: Nebula glow between arms (line 59-73) adds atmospheric depth. Only renders when bassE > 0.25 — good performance gate.
- ⚠️ Cảnh báo: Line 60 — `ctx.globalAlpha = 0.4` for nebula glow, reset at line 72 `ctx.globalAlpha = 1`. Same fragile pattern as plasma.ts — a nested `ctx.save()/restore()` would be safer.
- ✅ Tốt: Dust lane effect (line 93-99) with dark semi-transparent strip — adds realistic depth. Beat spiral expansion smoothly integrated.
- ✅ Tốt: Twinkling stars use deterministic seed-based animation (line 124-125) — `Math.sin(seed * 127.1 + time * 0.7)` — no `Math.random()`, safe for export.
- ✅ Tốt: Registration meta correct: id='galaxy', label='Thiên hà', icon='🌌', category='nature'.

### fire.ts
- ✅ Tốt: Flame shapes using `quadraticCurveTo` create realistic pointed flames. Heat haze at base adds depth.
- ✅ Tốt: Ember particles use deterministic seed-based positioning (line 137) — `const seed = em.x * 13.7 + em.y * 7.3 + e * 31.1` — safe for export.
- ⚠️ Cảnh báo: Line 132 — `ctx.globalAlpha = 0.8` for embers, reset at line 151. Same fragile pattern. Use nested `ctx.save()/restore()`.
- 🐛 Bug (minor): fire.ts icon='🔥' and firefly.ts icon='🔥' — both use the same icon! This will be confusing in the UI wave picker. One should be changed.
- ✅ Tốt: Flame tip white shift (line 96-97) provides nice visual feedback for high energy.
- ✅ Tốt: Registration meta correct: id='fire', label='Lửa', icon='🔥', category='nature'.

### neonbars.ts
- ✅ Tốt: Performance optimization (line 138-146) — small bars (t < 0.3) only get 2 passes instead of 5. This is a good practice for maintaining framerate.
- ✅ Tốt: Beat pulse wave (line 88-97) — expanding ring from center on strong beats. Only renders when beatV > 0.4, good performance gate.
- ✅ Tốt: Bar reflections (line 188-199) — subtle mirror ghost effect for tall bars. Low alpha (0.08 * t) keeps it subtle.
- ✅ Tốt: Connecting arcs (line 209-233) between adjacent high bar tips — nice visual connectivity. Treble-reactive threshold (> 0.35).
- ✅ Tốt: Custom neon palette (pink/cyan/violet) is distinctive. Corner glow beacons add atmosphere.
- ⚠️ Cảnh báo: Performance — for `barsPerEdge = 60`, total bars = 240, and each large bar gets 5 draw passes + reflection + tip particle = potentially ~7 draw calls per bar. With 240 bars, worst case is ~1680 draw calls. In practice, the `t < 0.03` skip and the performance optimization mitigate this, but it's worth monitoring on low-end devices.
- ✅ Tốt: Registration meta correct: id='neonbars', label='Neon 3D', icon='💡', category='tech'.

### crystalring.ts
- ✅ Tốt: Crystal facet effect (line 80-81) — `Math.floor(angle * 6) / 6` creates angular jumps that simulate faceted gem surface. Creative approach.
- ✅ Tốt: Color temperature shift (line 42-51) — warm→cool based on total energy. 7-color crystal palette is rich.
- ✅ Tốt: Light ray projections (line 136-163) from peak spectrum points — only renders when trebleE > 0.25. Uses gradient rays for realistic light diffraction.
- ⚠️ Cảnh báo: Line 137 — `ctx.globalAlpha = 0.5` for light rays, reset at line 163. Same fragile pattern.
- ✅ Tốt: Diamond sparkle particles (4-pointed star shape) at peak points — visually distinctive.
- ✅ Tốt: Scanning highlight orbiting the ring adds dynamic motion.
- ✅ Tốt: Inner refraction ring with conic gradient provides prismatic halo effect.
- 💡 Đề xuất: Line 13 — imports `getMaxOffset` and `WAVE_SEGMENTS` from helpers but also imports `getSampleAt` and `getSpectrumAt`. All are used — verified correct.
- ✅ Tốt: Registration meta correct: id='crystalring', label='Pha lê', icon='💎', category='artistic'.

---

## Agent 3 waves reviewed:

### nebula.ts
- ✅ Tốt: Spiral arm structure with 4 arms, dust lanes, color clouds — rich visual complexity.
- ✅ Tốt: Has `registerWaveCleanup` (line 297-300) for persistent shooting star state — correct cleanup pattern.
- 🐛 Bug: Lines 198-203 — `Math.random()` used for creating new shooting stars: `angle: Math.random() * Math.PI * 2`, `startR: baseR * 0.5 + Math.random() * baseR * 0.6`, etc. This means shooting stars will appear at different positions each time the same audio frame is rendered, which causes inconsistency in video export mode (frame-by-frame rendering). Should use deterministic pseudo-random based on `animTimeMs()` or a seed value.
- ⚠️ Cảnh báo: `shootingStars` array can grow up to 5 entries (line 205 caps it), but each star has lifecycle animation with `dt = 1/60 * spd` (line 207). The `1/60` assumes 60fps — if actual fps is different, star lifetimes will be incorrect.
- ✅ Tốt: Main arm drawing (nebula clouds, trail lines, star particles, stardust) all use deterministic positioning.
- ✅ Tốt: Registration meta correct: id='nebula', label='Tinh van', icon='✨', category='nature'.

### waterripple.ts
- ✅ Tốt: Excellent structure — concentric sine-wave rings with multi-harmonic perturbation for realistic water surface.
- ✅ Tốt: Persistent `ripplePhases` state with proper `registerWaveCleanup` (line 146).
- ✅ Tốt: Band-specific response — inner rings react to bass, middle to mid, outer to treble (line 67). Smart audio mapping.
- ✅ Tốt: Water surface tint gradient creates subtle depth. Caustic light patches (line 118-134) add realistic underwater lighting effect.
- ✅ Tốt: Bass burst on strong beats (line 106-116) — well-gated at beatVal > 0.45.
- ⚠️ Cảnh báo: Line 40 — `ripplePhases` initialized with `Math.random()`. This happens only once (on first render or after cleanup), so it's generally acceptable, but technically non-deterministic for export. Consider using seed-based initialization like `Math.sin(i * 127.1) * 0.5 + 0.5` for deterministic results.
- ✅ Tốt: 72 segments per ring with `smoothPath` — smooth visuals without excessive computation.
- ✅ Tốt: Registration meta correct: id='waterripple', label='Gợn nước', icon='💧', category='nature'.

### particles.ts
- ✅ Tốt: 60 particles with trail effect, attraction to center on bass, sparkle stars — comprehensive particle system.
- ✅ Tốt: Has `registerWaveCleanup` (line 206) for persistent particle pool — correct pattern.
- ✅ Tốt: Size diversity (line 42) — first 15 particles are micro-sized, rest are macro. Good visual variety.
- 🐛 Bug: Line 186 — `Math.random()` used in beat burst particles: `const dist = size * 0.04 * (0.5 + Math.random() * 0.5) * beatVal`. This creates non-deterministic particle positions per frame, which will cause visual flicker during video export. The beat burst should use a deterministic seed (e.g., `Math.sin(i * 49.7 + time * 3)`) instead.
- ⚠️ Cảnh báo: Lines 35-51 — `ensureParticles()` uses `Math.random()` for initial particle positions. This runs only once per lifecycle, but after cleanup and re-init (e.g., switching wave styles back), particles will spawn at different locations. Consider deterministic seeding.
- ⚠️ Cảnh báo: Lines 97-107 — Wrap-around logic uses `Math.random()` for repositioning: `p.x = Math.random() - 0.5`, `p.hue = Math.random()`. Same non-deterministic concern for export mode.
- ✅ Tốt: Sparkle star shapes (line 146-172) with rotating 4-point star + diagonal rays — visually distinctive.
- ✅ Tốt: Registration meta correct: id='particles', label='Hat sang', icon='✦', category='artistic'.

### musicnotes.ts
- ✅ Tốt: Faithful H2O Music style recreation — grid overlay, orbit rings, rotating notes, side EQ bars, corner accents.
- ✅ Tốt: No persistent state needed, no `registerWaveCleanup` — correct since all rendering is purely time-based.
- ✅ Tốt: Side EQ bars (line 142-202) with mirror-fold spectrum (`mj`) and gradient fills — professional look.
- ⚠️ Cảnh báo: Line 172 — uses `ctx.roundRect()`. This is a relatively new Canvas API method (Chrome 99+, Firefox 112+). Should be safe for Electron 36, but verify if any fallback is needed for older Electron versions.
- ✅ Tốt: Music note rendering with `ctx.fillText()` for Unicode symbols — clever approach that avoids complex path drawing.
- ✅ Tốt: Corner accent dots and orbiting highlight add finishing touches.
- ✅ Tốt: Registration meta correct: id='musicnotes', label='Nốt nhạc', icon='🎵', category='artistic'.

### firefly.ts
- ✅ Tốt: Lissajous flight paths (`Math.sin(time * f.freqX + f.phaseX)`) create naturalistic firefly movement.
- ✅ Tốt: Synchronized blink on bass (line 85-86) — all fireflies glow together when bass > 0.6. Elegant effect.
- ✅ Tốt: Has `registerWaveCleanup` (line 170) for persistent firefly pool — correct pattern.
- ✅ Tốt: Warm yellow-green palette (line 53-58) is thematically appropriate.
- ✅ Tốt: Trail calculation using derivative of Lissajous curve (line 102-105) — mathematically correct direction.
- 🐛 Bug: Line 165 — Icon is `'🔥'` which is identical to fire.ts icon `'🔥'`. Firefly should use a different icon like `'✨'` or `'🪲'` to avoid confusion in the wave style picker UI.
- ✅ Tốt: No `Math.random()` in render loop — all randomness is in `ensureFireflies()` initialization only. Render is fully deterministic after init.
- ✅ Tốt: Registration meta correct except icon conflict: id='firefly', label='Dom dom', icon='🔥', category='nature'.

### sakura.ts
- ✅ Tốt: Beautiful cherry blossom petal shape using bezier curves (line 49-56). Depth illusion via rotation-based scaling (line 139).
- ✅ Tốt: Has `registerWaveCleanup` (line 216) for persistent petal pool — correct pattern.
- ✅ Tốt: Custom sakura pink palette (line 59-65) with hue variation from light pink to deeper pink.
- ✅ Tốt: Supports both custom `vc` colors and default sakura palette — flexible.
- 🐛 Bug: Lines 194, 200 — `Math.random()` used in beat swirl particles: `const dist = size * 0.03 * (0.3 + Math.random() * 0.7) * beatVal` and `sakuraColor(Math.random(), ...)`. Non-deterministic per frame, will flicker during video export. Should use deterministic seed.
- ⚠️ Cảnh báo: Lines 126-128 — Wrap-around respawn uses `Math.random()` for new position: `p.x = (Math.random() - 0.5) * 1.2`. Same concern as particles.ts for export determinism.
- ✅ Tốt: Center vein line on petals (line 178-184) — nice detail that adds realism.
- ✅ Tốt: Registration meta correct: id='sakura', label='Hoa anh dao', icon='🌸', category='nature'.

---

## Summary

### Tổng bugs tìm thấy: 4

| # | Severity | File | Issue |
|---|----------|------|-------|
| 1 | Medium | `nebula.ts:198-203` | `Math.random()` in shooting star creation — non-deterministic for export |
| 2 | Medium | `particles.ts:186` | `Math.random()` in beat burst — non-deterministic for export |
| 3 | Medium | `sakura.ts:194,200` | `Math.random()` in beat swirl — non-deterministic for export |
| 4 | Low | `firefly.ts:165` + `fire.ts:159` | Duplicate icon '🔥' — both fire and firefly use same icon in wave picker |

### Tổng đề xuất: 6

| # | File | Suggestion |
|---|------|------------|
| 1 | `plasma.ts`, `galaxy.ts`, `fire.ts`, `crystalring.ts` | Replace `ctx.globalAlpha` set/reset with nested `ctx.save()/restore()` for safety |
| 2 | `nebula.ts:207` | `dt = 1/60` assumes 60fps — consider using actual delta time |
| 3 | `waterripple.ts:40` | Use deterministic seed for `ripplePhases` initialization |
| 4 | `particles.ts:35-51,97-107` | Use deterministic seed for particle init & wrap-around repositioning |
| 5 | `neonbars.ts` | Monitor performance on low-end devices — worst case ~1680 draw calls |
| 6 | `lightning.ts:29` | Consider variable bolt change interval for more organic feel |

### Build status: pending (will verify next)

### Overall Assessment

**Agent 2 (plasma, lightning, galaxy, fire, neonbars, crystalring)**: High quality code. All files have proper `ctx.save()/restore()`, correct registration, and thoughtful visual effects. The main pattern concern is `ctx.globalAlpha` usage without nested save/restore — functional but fragile. Lightning's deterministic `rng()` is the best practice model for randomness. Fire + firefly icon conflict should be resolved.

**Agent 3 (nebula, waterripple, particles, musicnotes, firefly, sakura)**: Good quality with creative visual effects. The main concern is `Math.random()` usage in render-time code (nebula shooting stars, particles beat burst, sakura beat swirl). These will produce non-deterministic results during video export. Waterripple and musicnotes are the strongest — clean, deterministic, well-structured. Firefly is nearly perfect except for the icon conflict.
