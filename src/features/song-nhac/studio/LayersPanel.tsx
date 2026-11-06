import { useState } from 'react'
import { isGroupLayer, isVisualizerLayer, type StudioAnyLayer } from './layerTypes'
import { useSongNhacLayerStore } from './songNhacLayerStore'
import { LayerContextMenu, type LayerMenuState } from './LayerContextMenu'
import { WAVE_PRESETS } from './builtInPresets'
import {
  deleteTemplate,
  listTemplates,
  loadTemplate,
  saveTemplate,
} from './songNhacTemplateStore'

function localFileUrl(filePath: string): string {
  return `app://local-file/?path=${encodeURIComponent(filePath)}`
}

const panelStyle: React.CSSProperties = {
  background: '#0b1220',
  border: '1px solid #1e293b',
  borderRadius: 10,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}
const headerStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 12,
  fontWeight: 700,
  color: '#93c5fd',
  letterSpacing: 0.4,
  textTransform: 'uppercase',
  borderBottom: '1px solid #1e293b',
}
const buttonStyle: React.CSSProperties = {
  padding: '5px 8px',
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 6,
  color: '#e2e8f0',
  fontSize: 11,
  cursor: 'pointer',
}
const miniButtonStyle: React.CSSProperties = {
  padding: '1px 5px',
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 4,
  color: '#cbd5e1',
  fontSize: 10,
  cursor: 'pointer',
}

const TYPE_LABEL: Record<string, string> = {
  image: 'Ảnh',
  text: 'Chữ',
  video: 'Video',
  visualizer: 'Sóng',
  group: 'Nhóm',
}

export function LayersPanel({ onChoosePreset }: { onChoosePreset?: () => void } = {}) {
  const layers = useSongNhacLayerStore((state) => state.layers)
  const selectedLayerId = useSongNhacLayerStore((state) => state.selectedLayerId)
  const selectedIds = useSongNhacLayerStore((state) => state.selectedIds)
  const setSelection = useSongNhacLayerStore((state) => state.setSelection)
  const addImageLayer = useSongNhacLayerStore((state) => state.addImageLayer)
  const addVideoLayer = useSongNhacLayerStore((state) => state.addVideoLayer)
  const addTextLayer = useSongNhacLayerStore((state) => state.addTextLayer)
  const addVisualizerLayer = useSongNhacLayerStore((state) => state.addVisualizerLayer)
  const addLogoLayer = useSongNhacLayerStore((state) => state.addLogoLayer)
  const addIntroLayer = useSongNhacLayerStore((state) => state.addIntroLayer)
  const addGroup = useSongNhacLayerStore((state) => state.addGroup)
  const addParticlesLayer = useSongNhacLayerStore((state) => state.addParticlesLayer)
  const moveLayerUp = useSongNhacLayerStore((state) => state.moveLayerUp)
  const moveLayerDown = useSongNhacLayerStore((state) => state.moveLayerDown)
  const removeLayer = useSongNhacLayerStore((state) => state.removeLayer)
  const updateLayer = useSongNhacLayerStore((state) => state.updateLayer)
  const updateLayerWithHistory = useSongNhacLayerStore((state) => state.updateLayerWithHistory)
  const toggleGroupExpanded = useSongNhacLayerStore((state) => state.toggleGroupExpanded)
  const expandedGroupIds = useSongNhacLayerStore((state) => state.expandedGroupIds)
  const editingGroupId = useSongNhacLayerStore((state) => state.editingGroupId)
  const setEditingGroupId = useSongNhacLayerStore((state) => state.setEditingGroupId)
  const moveLayerInGroup = useSongNhacLayerStore((state) => state.moveLayerInGroup)

  const pickMedia = async (kind: 'image' | 'video') => {    const filters = kind === 'image'
      ? [{ name: 'Ảnh', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
      : [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm'] }]
    const picked = await window.api.dialog.openFile({ properties: ['openFile'], filters })
    const filePath = picked?.filePaths?.[0]
    if (!filePath) return null
    return { path: localFileUrl(filePath), name: filePath.split(/[\\/]/).pop() || 'Media' }
  }

  const [templates, setTemplates] = useState(() => listTemplates())
  const [layerMenu, setLayerMenu] = useState<LayerMenuState | null>(null)

  const applyPreset = (presetId: string) => {
    const preset = WAVE_PRESETS.find((item) => item.id === presetId)
    if (!preset) return
    const state = useSongNhacLayerStore.getState()
    const existing = state.layers.find((layer) => layer.type === 'visualizer')
    if (existing) {
      state.updateLayerWithHistory(existing.id, preset.visualizer as Partial<StudioAnyLayer>)
      state.setSelection(existing.id)
      return
    }
    const id = state.addVisualizerLayer('Sóng nhạc', preset.visualizer.waveStyle)
    state.updateLayerWithHistory(id, preset.visualizer as Partial<StudioAnyLayer>)
  }

  const saveCurrentTemplate = () => {
    const name = window.prompt('Tên template')
    if (!name) return
    saveTemplate(name, useSongNhacLayerStore.getState().layers)
    setTemplates(listTemplates())
  }

  const applyTemplate = (templateId: string) => {
    const nextLayers = loadTemplate(templateId)
    if (nextLayers) useSongNhacLayerStore.getState().applyTemplateLayers(nextLayers)
  }

  const roots = layers.filter((layer) => isGroupLayer(layer) || !layer.parentId)
  const displayOrder = [...roots].reverse()

  const renderRow = (layer: StudioAnyLayer) => {
    const active = layer.id === selectedLayerId
    const selected = selectedIds.includes(layer.id)
    const isGroup = isGroupLayer(layer)
    const expanded = isGroup && Boolean(expandedGroupIds[layer.id]) || (isGroup && editingGroupId === layer.id)
    const isWatermark = !isGroup && layer.role === 'watermark'
    const timeRange = !isGroup ? layer.timeRange : undefined

    return (
      <div key={layer.id}>
        <div
          onClick={(event) => setSelection(layer.id, { ctrlKey: event.ctrlKey, shiftKey: event.shiftKey })}
          onContextMenu={(event) => {
            event.preventDefault()
            setSelection(layer.id)
            setLayerMenu({ x: event.clientX, y: event.clientY, layerId: layer.id })
          }}
          onDoubleClick={() => (isGroup ? setEditingGroupId(editingGroupId === layer.id ? null : layer.id) : undefined)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 6px',
            borderRadius: 6,
            cursor: 'pointer',
            background: selected ? (active ? '#1d4ed8' : '#1e3a8a') : '#0f172a',
            border: `1px solid ${active ? '#3b82f6' : '#1e293b'}`,
            opacity: layer.type === 'group' || layer.visible ? 1 : 0.5,
          }}
        >
          {isGroup && (
            <button type="button" style={miniButtonStyle} onClick={(event) => { event.stopPropagation(); toggleGroupExpanded(layer.id) }}>
              {expanded ? '-' : '+'}
            </button>
          )}
          <span style={{ fontSize: 10, color: '#64748b', minWidth: 34 }}>{TYPE_LABEL[layer.type] ?? layer.type}</span>
          <span style={{ flex: 1, fontSize: 12, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {layer.name}
            {isVisualizerLayer(layer) ? ` · ${layer.waveStyle}` : ''}
          </span>
          {isWatermark && <span style={{ fontSize: 9, color: '#38bdf8' }}>LOGO</span>}
          {timeRange && <span style={{ fontSize: 9, color: '#a78bfa' }}>{Math.round(timeRange.startSec)}-{Math.round(timeRange.endSec)}s</span>}
          {!isGroup && (
            <>
              <button
                type="button"
                style={miniButtonStyle}
                onClick={(event) => { event.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }) }}
              >
                {layer.visible ? 'Ẩn' : 'Hiện'}
              </button>
              <button
                type="button"
                style={miniButtonStyle}
                onClick={(event) => { event.stopPropagation(); updateLayerWithHistory(layer.id, { locked: !layer.locked }) }}
                title="Khoá lớp"
              >
                {layer.locked ? 'Mở' : 'Khoá'}
              </button>
            </>
          )}
          <button type="button" style={miniButtonStyle} onClick={(event) => { event.stopPropagation(); moveLayerUp(layer.id) }} title="Lên">↑</button>
          <button type="button" style={miniButtonStyle} onClick={(event) => { event.stopPropagation(); moveLayerDown(layer.id) }} title="Xuống">↓</button>
          <button type="button" style={{ ...miniButtonStyle, color: '#fca5a5' }} onClick={(event) => { event.stopPropagation(); removeLayer(layer.id) }} title="Xoá">x</button>
        </div>

        {isGroup && expanded && layer.children.map((childId, childIndex) => {
          const child = layers.find((item) => item.id === childId)
          if (!child) return null
          return (
            <div
              key={child.id}
              onClick={(event) => setSelection(child.id, { ctrlKey: event.ctrlKey, shiftKey: event.shiftKey })}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                marginLeft: 16,
                padding: '3px 6px',
                borderRadius: 6,
                cursor: 'pointer',
                background: child.id === selectedLayerId ? '#1e3a8a' : 'transparent',
                border: '1px solid transparent',
              }}
            >
              <span style={{ fontSize: 10, color: '#64748b', minWidth: 34 }}>{TYPE_LABEL[child.type] ?? child.type}</span>
              <span style={{ flex: 1, fontSize: 11, color: '#cbd5e1' }}>{child.name}</span>
              {editingGroupId === layer.id && (
                <>
                  <button type="button" style={miniButtonStyle} onClick={(event) => { event.stopPropagation(); moveLayerInGroup(layer.id, childIndex, Math.max(0, childIndex - 1)) }}>↑</button>
                  <button type="button" style={miniButtonStyle} onClick={(event) => { event.stopPropagation(); moveLayerInGroup(layer.id, childIndex, Math.min(layer.children.length - 1, childIndex + 1)) }}>↓</button>
                </>
              )}
            </div>
          )
        })}

        {isGroup && layer.children.length > 0 && !expanded && (
          <div style={{ marginLeft: 20, fontSize: 10, color: '#475569' }}>{layer.children.length} lớp con</div>
        )}
      </div>
    )
  }

  return (
    <section style={panelStyle}>
      <div style={headerStyle}>Lớp</div>
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          <button type="button" style={buttonStyle} onClick={async () => {
            const media = await pickMedia('image')
            if (media) addImageLayer('Ảnh nền', media.path)
          }}>Ảnh</button>
          <button type="button" style={buttonStyle} onClick={async () => {
            const media = await pickMedia('video')
            if (media) addVideoLayer('Video nền', media.path)
          }}>Video</button>
          <button type="button" style={buttonStyle} onClick={() => addTextLayer()}>Chữ</button>
          <button type="button" style={buttonStyle} onClick={() => addVisualizerLayer()}>Sóng</button>
          <button type="button" style={buttonStyle} onClick={() => addParticlesLayer()}>Hạt</button>
          <button type="button" style={buttonStyle} onClick={async () => {
            const media = await pickMedia('image')
            if (media) addLogoLayer(media.path)
          }}>Logo</button>
          <button type="button" style={buttonStyle} onClick={() => addIntroLayer(5)}>Intro</button>
          <button type="button" style={buttonStyle} onClick={() => addGroup()}>Nhóm</button>
        </div>

        <div style={{ display: 'flex', gap: 4 }}>
          <select
            value=""
            onChange={(event) => applyPreset(event.target.value)}
            style={{ flex: 1, background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 11, padding: '4px 6px' }}
          >
            <option value="">Preset sóng…</option>
            {WAVE_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.name}</option>
            ))}
          </select>
          <button type="button" style={buttonStyle} onClick={saveCurrentTemplate} title="Lưu template">Lưu</button>
        </div>

        {templates.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 10, color: '#64748b' }}>Template đã lưu</div>
            {templates.map((template) => (
              <div key={template.id} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button
                  type="button"
                  style={{ ...buttonStyle, flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  onClick={() => applyTemplate(template.id)}
                  title={`${template.layers.length} lớp`}
                >
                  {template.name}
                </button>
                <button
                  type="button"
                  style={{ ...miniButtonStyle, color: '#fca5a5' }}
                  onClick={() => {
                    deleteTemplate(template.id)
                    setTemplates(listTemplates())
                  }}
                  title="Xoá template"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {displayOrder.length === 0 ? (
            <div style={{ fontSize: 11, color: '#475569', padding: 8 }}>Chưa có lớp. Thêm Ảnh, Chữ hoặc Sóng để bắt đầu.</div>
          ) : (
            displayOrder.map(renderRow)
          )}
        </div>
      </div>
      {layerMenu && (
        <LayerContextMenu
          menu={layerMenu}
          onClose={() => setLayerMenu(null)}
          onChoosePreset={() => onChoosePreset?.()}
        />
      )}
    </section>
  )
}
