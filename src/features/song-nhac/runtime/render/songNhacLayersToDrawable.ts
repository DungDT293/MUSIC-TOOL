/**
 * Phase 3 — Chuyển store layers (SongNhacLayer[]) sang DrawableLayer[] cho runtime.
 * V2: Map thêm filter, flipX/flipY, text extras (stroke, shadow, font).
 * V3: Map thêm timeRange, role (watermark/logo).
 */

import type { SongNhacLayer } from '../../types/layerTypes'
import type { DrawableLayer } from './drawLayers'

export function songNhacLayersToDrawable(layers: SongNhacLayer[]): DrawableLayer[] {
  return layers
    .filter((l) => l.type === 'image' || l.type === 'text' || l.type === 'visualizer' || l.type === 'video')
    .map((l) => {
      const base = {
        type: l.type as DrawableLayer['type'],
        visible: l.visible,
        transform: (l as any).transform,
        filter: (l as any).filter,
        timeRange: (l as any).timeRange,
        role: (l as any).role,
      }

      if (l.type === 'image') {
        return {
          ...base,
          src: l.src,
          fitMode: l.fitMode,
          waveAroundEnabled: l.waveAroundEnabled,
        }
      }
      if (l.type === 'video') {
        return {
          ...base,
          src: l.src,
          fitMode: l.fitMode,
          muted: l.muted,
          volume: l.volume,
        }
      }
      if (l.type === 'text') {
        return {
          ...base,
          text: l.text,
          fontSize: l.fontSize,
          color: l.color,
          fontFamily: l.fontFamily,
          fontWeight: l.fontWeight,
          italic: l.italic,
          strokeColor: l.strokeColor,
          strokeWidth: l.strokeWidth,
          textShadowColor: l.textShadowColor,
          textShadowBlur: l.textShadowBlur,
          textShadowOffsetX: l.textShadowOffsetX,
          textShadowOffsetY: l.textShadowOffsetY,
        }
      }
      if (l.type === 'visualizer') {
        return {
          ...base,
          waveStyle: l.waveStyle,
          opacity: l.opacity,
          sensitivity: l.sensitivity,
          colorMode: l.colorMode,
          color1: l.color1,
          color2: l.color2,
          glowEnabled: l.glowEnabled,
          glowIntensity: l.glowIntensity,
          mirror: l.mirror,
          barCount: l.barCount,
          speed: l.speed,
        }
      }
      return base
    })
}
