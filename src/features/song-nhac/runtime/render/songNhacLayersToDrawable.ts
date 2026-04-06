/**
 * Phase 3 — Chuyển store layers (SongNhacLayer[]) sang DrawableLayer[] cho runtime.
 * V2: Map thêm filter, flipX/flipY, text extras (stroke, shadow, font).
 * V3: Map thêm timeRange, role (watermark/logo).
 * V4: Proper type-safe access — no `as any` casts.
 */

import type {
  SongNhacLayer,
  SongNhacImageLayer,
  SongNhacTextLayer,
  SongNhacVisualizerLayer,
  SongNhacVideoLayer,
  SongNhacBaseLayer,
} from '../../types/layerTypes'
import type { DrawableLayer } from './drawLayers'

/** Extract shared base fields from any non-group layer. */
function mapBase(l: SongNhacBaseLayer): Pick<DrawableLayer, 'type' | 'visible' | 'transform' | 'filter' | 'timeRange' | 'role'> {
  return {
    type: l.type,
    visible: l.visible,
    transform: l.transform,
    filter: l.filter,
    timeRange: l.timeRange,
    role: l.role,
  }
}

export function songNhacLayersToDrawable(layers: SongNhacLayer[]): DrawableLayer[] {
  return layers
    .filter((l): l is Exclude<SongNhacLayer, { type: 'group' }> =>
      l.type === 'image' || l.type === 'text' || l.type === 'visualizer' || l.type === 'video'
    )
    .map((l): DrawableLayer => {
      switch (l.type) {
        case 'image': {
          const img = l as SongNhacImageLayer
          return {
            ...mapBase(img),
            type: 'image',
            src: img.src,
            fitMode: img.fitMode,
            waveAroundEnabled: img.waveAroundEnabled,
          }
        }
        case 'video': {
          const vid = l as SongNhacVideoLayer
          return {
            ...mapBase(vid),
            type: 'video',
            src: vid.src,
            fitMode: vid.fitMode,
            muted: vid.muted,
            volume: vid.volume,
          }
        }
        case 'text': {
          const txt = l as SongNhacTextLayer
          return {
            ...mapBase(txt),
            type: 'text',
            text: txt.text,
            fontSize: txt.fontSize,
            color: txt.color,
            fontFamily: txt.fontFamily,
            fontWeight: txt.fontWeight,
            italic: txt.italic,
            strokeColor: txt.strokeColor,
            strokeWidth: txt.strokeWidth,
            textShadowColor: txt.textShadowColor,
            textShadowBlur: txt.textShadowBlur,
            textShadowOffsetX: txt.textShadowOffsetX,
            textShadowOffsetY: txt.textShadowOffsetY,
          }
        }
        case 'visualizer': {
          const viz = l as SongNhacVisualizerLayer
          return {
            ...mapBase(viz),
            type: 'visualizer',
            waveStyle: viz.waveStyle,
            opacity: viz.opacity,
            sensitivity: viz.sensitivity,
            colorMode: viz.colorMode,
            color1: viz.color1,
            color2: viz.color2,
            glowEnabled: viz.glowEnabled,
            glowIntensity: viz.glowIntensity,
            mirror: viz.mirror,
            barCount: viz.barCount,
            barWidth: viz.barWidth,
            speed: viz.speed,
          }
        }
      }
    })
}
