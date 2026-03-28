/**
 * Chức năng 13 — Bước 4. Timeline.
 * Chỉ vẽ từ precomputed data (peaks + beats). Re-render khi zoom/scroll/data đổi.
 * ❌ Không RAF ❌ Không FFT ❌ Không import runtime/audio/engine.
 */

import { useRef, useEffect } from 'react'
import { useSongNhacTimelineStore } from '../store/songNhacTimelineStore'
import { drawTimeline } from './drawTimeline'

export default function TimelineView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const timelineData = useSongNhacTimelineStore((s) => s.timelineData)
  const zoom = useSongNhacTimelineStore((s) => s.zoom)
  const scrollPx = useSongNhacTimelineStore((s) => s.scrollPx)
  const playheadTimeSec = useSongNhacTimelineStore((s) => s.playheadTimeSec)
  const isLoadingTimeline = useSongNhacTimelineStore((s) => s.isLoadingTimeline)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const canvas = document.createElement('canvas')
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.background = '#0f0f1a'
    canvasRef.current = canvas
    el.appendChild(canvas)

    const onResize = () => {
      const rect = el.getBoundingClientRect()
      const w = Math.floor(rect.width)
      const h = Math.floor(rect.height)
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (ctx) {
        const s = useSongNhacTimelineStore.getState()
        drawTimeline(ctx, {
          data: s.timelineData,
          zoom: s.zoom,
          scrollPx: s.scrollPx,
          playheadTimeSec: s.playheadTimeSec,
          width: w,
          height: h,
        })
      }
    }

    onResize()
    const ro = new ResizeObserver(onResize)
    ro.observe(el)

    return () => {
      ro.disconnect()
      canvasRef.current = null
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = canvas.width
    const h = canvas.height
    if (w <= 0 || h <= 0) return
    drawTimeline(ctx, {
      data: timelineData,
      zoom,
      scrollPx,
      playheadTimeSec,
      width: w,
      height: h,
    })
  }, [timelineData, zoom, scrollPx, playheadTimeSec])

  const setScrollPx = useSongNhacTimelineStore((s) => s.setScrollPx)
  const setZoom = useSongNhacTimelineStore((s) => s.setZoom)

  const handleWheel = (e: React.WheelEvent) => {
    if (!timelineData) return
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      setZoom(zoom * (e.deltaY > 0 ? 0.9 : 1.1))
    } else {
      setScrollPx(scrollPx + e.deltaY)
    }
  }

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 6,
        border: '1px solid rgba(255,255,255,0.08)',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {isLoadingTimeline && (
        <div
          style={{
            position: 'absolute',
            top: 4,
            left: 8,
            fontSize: 10,
            color: 'rgba(255,255,255,0.6)',
          }}
        >
          Đang tính waveform…
        </div>
      )}
    </div>
  )
}
