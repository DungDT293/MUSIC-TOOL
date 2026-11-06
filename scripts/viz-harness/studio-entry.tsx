import React from 'react'
import { createRoot } from 'react-dom/client'
import { LayersPanel } from '../../src/features/song-nhac/studio/LayersPanel'
import { InspectorPanel } from '../../src/features/song-nhac/studio/InspectorPanel'
import { useSongNhacLayerStore } from '../../src/features/song-nhac/studio/songNhacLayerStore'

;(window as unknown as Record<string, unknown>).__store = useSongNhacLayerStore
const store = useSongNhacLayerStore.getState()
store.addTextLayer('Tên bài hát')
store.addImageLayer('Ảnh nền', '')
store.addVisualizerLayer('Sóng nhạc')
const textLayer = useSongNhacLayerStore.getState().layers.find((layer) => layer.type === 'text')
if (textLayer) useSongNhacLayerStore.getState().setSelection(textLayer.id)

function App() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '340px 380px', gap: 12, padding: 12, background: '#020617', minHeight: '100vh' }}>
      <LayersPanel />
      <InspectorPanel />
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
