/**
 * Wave Style Plugin System — Auto-import tất cả wave styles.
 *
 * THÊM WAVE MỚI:
 * 1. Tạo file waves/myWave.ts
 * 2. Implement WaveDrawFn + gọi registerWave()
 * 3. Thêm 1 dòng import ở đây: import './myWave'
 *
 * → Không cần sửa drawLayers.ts, không conflict!
 */

// ─── Core ───────────────────────────────────────────────────────────────────
export { registerWave, registerWaveCleanup, getWaveDrawFn, getWaveMeta, getAllWaveIds, getAllWaveMetas, hasWaveStyle, resetAllWaveState, getWaveCount } from './registry'
export type { WaveDrawFn, WaveStyleMeta, WaveStyleEntry, WaveStateCleanup } from './types'
export { setAnimTimeSec, animTimeSec, animTimeMs, updateSmoothedSpectrum, resetSmoothedSpectrum, deterministicRandom } from './helpers'
export type { FrequencyBands, VisualizerColorOptions } from './helpers'

// ─── Wave Styles (import = auto-register) ───────────────────────────────────
import './bars'
import './circlebars'
import './line'
import './ring'
import './dots'
import './waveform'
import './plasma'
import './lightning'
import './galaxy'
import './fire'
import './neonbars'
import './crystalring'
import './nebula'
import './waterripple'
import './particles'
import './musicnotes'
import './beatbars'
import './helix'
import './aurora'
import './heartbeat'
import './starburst'
import './matrix'
import './spectrum3d'
import './oscilloscope'
import './vinyl'
import './firefly'
import './sakura'
import './diamondgrid'
import './radar'
import './vortex'
import './shockwave'
