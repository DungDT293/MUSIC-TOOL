/**
 * Chức năng 13 — Layout contract 5 vùng.
 * V2: Wider panels, proper sizing for pro-editor feel.
 *
 * ┌────────────────────────────────────────────────────────────────┐
 * │                         TOOLBAR (header)                       │
 * ├──────────────┬─────────────────────────────────┬──────────────┤
 * │  LEFT PANEL  │       PREVIEW CANVAS             │ RIGHT PANEL  │
 * │  (Layers +   │  (Dual-canvas / Gizmo)           │ (Inspector)  │
 * │   Background)│                                  │              │
 * ├──────────────┴─────────────────────────────────┴──────────────┤
 * │                      TRANSPORT BAR                             │
 * ├────────────────────────────────────────────────────────────────┤
 * │                         TIMELINE                               │
 * └────────────────────────────────────────────────────────────────┘
 */

import type { ReactNode } from 'react'

const LAYOUT = {
  leftWidth: 260,
  rightWidth: 300,
  timelineHeight: 160,
  transportHeight: 40,
  gap: 6,
  headerHeight: 44,
} as const

export interface VisualizerLayoutProps {
  /** Vùng trái: layer stack + engine list */
  leftPanel: ReactNode
  /** Vùng giữa: preview canvas (dual-canvas / gizmo) */
  preview: ReactNode
  /** Vùng phải: inspector / engine params */
  rightPanel: ReactNode
  /** Thanh timeline (audio waveform / beat / layers) */
  timeline: ReactNode
  /** Thanh công cụ trên preview (play, export, FPS, quality) — tùy chọn */
  toolbar?: ReactNode
  /** Thanh transport (time + seek) ngay trên Timeline */
  transport?: ReactNode
}

export default function VisualizerLayout({
  leftPanel,
  preview,
  rightPanel,
  timeline,
  toolbar,
  transport,
}: VisualizerLayoutProps) {
  return (
    <div
      className="visualizer-layout"
      style={{
        width: '100%',
        height: '100%',
        minHeight: 400,
        display: 'grid',
        gridTemplateColumns: `${LAYOUT.leftWidth}px 1fr ${LAYOUT.rightWidth}px`,
        gridTemplateRows: `${LAYOUT.headerHeight}px 1fr ${LAYOUT.transportHeight}px ${LAYOUT.timelineHeight}px`,
        gridTemplateAreas: `
          "toolbar toolbar toolbar"
          "left preview right"
          "transport transport transport"
          "timeline timeline timeline"
        `,
        gap: LAYOUT.gap,
        background: '#12121f',
        color: '#e8e8e8',
        padding: LAYOUT.gap,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ gridArea: 'toolbar', minHeight: 0, overflow: 'hidden' }}>
        {toolbar}
      </div>
      <div style={{ gridArea: 'left', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {leftPanel}
      </div>
      <div style={{ gridArea: 'preview', minHeight: 0, position: 'relative' }}>
        {preview}
      </div>
      <div style={{ gridArea: 'right', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {rightPanel}
      </div>
      <div style={{ gridArea: 'transport', minHeight: 0 }}>
        {transport}
      </div>
      <div style={{ gridArea: 'timeline', minHeight: 0, overflow: 'hidden' }}>
        {timeline}
      </div>
    </div>
  )
}

export { LAYOUT }
