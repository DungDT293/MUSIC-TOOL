/**
 * Phase 2 — Layers panel: danh sách layer, thêm Image/Text/Wave/Video, xóa, sắp xếp.
 * V2: Cleaner UX — top action bar, layer type icons, fixed isFirst/isLast logic.
 */

import { useRef, useState, useEffect } from 'react'
import { useSongNhacLayerStore } from '../store/songNhacLayerStore'
import { useSongNhacTemplateStore } from '../store/songNhacTemplateStore'
import { useSongNhacAudioStore } from '../store/songNhacAudioStore'
import { BUILT_IN_PRESETS } from '../store/builtInPresets'
import type { SongNhacLayer, SongNhacGroupLayer } from '../types/layerTypes'
import { isSongNhacImageLayer, isSongNhacGroupLayer, isSongNhacVisualizerLayer, isSongNhacVideoLayer } from '../types/layerTypes'

/* ── Styles ── */
const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  padding: 0,
}

const LAYER_TYPE_ICON: Record<string, string> = {
  image: '🖼️',
  text: '📝',
  visualizer: '🎵',
  video: '🎬',
  group: '📁',
}

const LAYER_TYPE_COLOR: Record<string, string> = {
  image: '#1a4a2e',
  text: '#2a2a1a',
  visualizer: '#1a2a4a',
  video: '#3a1a3a',
  group: '#2a2a2a',
}

function addBtn(color = 'rgba(255,255,255,0.07)'): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '5px 8px',
    fontSize: 10,
    fontWeight: 600,
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 5,
    background: color,
    color: 'rgba(255,255,255,0.8)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  }
}

const iconBtn: React.CSSProperties = {
  padding: '2px 5px',
  fontSize: 11,
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 4,
  background: 'rgba(255,255,255,0.04)',
  color: 'rgba(255,255,255,0.7)',
  cursor: 'pointer',
  lineHeight: 1,
}

export default function LayersPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const introInputRef = useRef<HTMLInputElement>(null)
  const outroInputRef = useRef<HTMLInputElement>(null)
  const layers = useSongNhacLayerStore((s) => s.layers)
  const selectedIds = useSongNhacLayerStore((s) => s.selectedIds)
  const setSelection = useSongNhacLayerStore((s) => s.setSelection)
  const addImageLayer = useSongNhacLayerStore((s) => s.addImageLayer)
  const addTextLayer = useSongNhacLayerStore((s) => s.addTextLayer)
  const addVisualizerLayer = useSongNhacLayerStore((s) => s.addVisualizerLayer)
  const addVideoLayer = useSongNhacLayerStore((s) => s.addVideoLayer)
  const addLogoLayer = useSongNhacLayerStore((s) => s.addLogoLayer)
  const addIntroLayer = useSongNhacLayerStore((s) => s.addIntroLayer)
  const addOutroLayer = useSongNhacLayerStore((s) => s.addOutroLayer)
  const audioDuration = useSongNhacAudioStore((s) => s.durationSec)
  const removeLayer = useSongNhacLayerStore((s) => s.removeLayer)
  const moveLayerUp = useSongNhacLayerStore((s) => s.moveLayerUp)
  const moveLayerDown = useSongNhacLayerStore((s) => s.moveLayerDown)
  const updateLayer = useSongNhacLayerStore((s) => s.updateLayer)
  const pushHistorySnapshot = useSongNhacLayerStore((s) => s.pushHistorySnapshot)
  const addGroup = useSongNhacLayerStore((s) => s.addGroup)
  const addLayerToGroup = useSongNhacLayerStore((s) => s.addLayerToGroup)
  const removeFromGroup = useSongNhacLayerStore((s) => s.removeFromGroup)
  const moveLayerInGroup = useSongNhacLayerStore((s) => s.moveLayerInGroup)
  const editingGroupId = useSongNhacLayerStore((s) => s.editingGroupId)
  const setEditingGroupId = useSongNhacLayerStore((s) => s.setEditingGroupId)
  const expandedGroupIds = useSongNhacLayerStore((s) => s.expandedGroupIds)
  const toggleGroupExpanded = useSongNhacLayerStore((s) => s.toggleGroupExpanded)
  const updateLayerWithHistory = useSongNhacLayerStore((s) => s.updateLayerWithHistory)
  const applyTemplateLayers = useSongNhacLayerStore((s) => s.applyTemplateLayers)
  const [addToGroupLayerId, setAddToGroupLayerId] = useState<string | null>(null)

  // Close "add to group" dropdown when clicking outside
  useEffect(() => {
    if (!addToGroupLayerId) return
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Element | null
      if (!target?.closest('[data-add-to-group]')) {
        setAddToGroupLayerId(null)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [addToGroupLayerId])

  const templates = useSongNhacTemplateStore((s) => s.templates)
  const saveTemplate = useSongNhacTemplateStore((s) => s.saveTemplate)
  const loadTemplate = useSongNhacTemplateStore((s) => s.loadTemplate)
  const deleteTemplate = useSongNhacTemplateStore((s) => s.deleteTemplate)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [templateError, setTemplateError] = useState<string | null>(null)
  const [showPresets, setShowPresets] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)

  // displayOrder: reversed so top layer shows first in the list (canvas paints bottom→top)
  const roots = layers.filter((l) => !(l as { parentId?: string }).parentId)
  const displayOrder = [...roots].reverse()

  const handleAddImage = () => fileInputRef.current?.click()
  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file && file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      const id = addImageLayer(undefined, url)
      const img = new Image()
      img.onload = () => {
        updateLayer(id, { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight })
      }
      img.src = url
    }
  }

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file && file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      const id = addLogoLayer(url)
      const img = new Image()
      img.onload = () => {
        updateLayer(id, { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight })
      }
      img.src = url
    }
  }

  const handleIntroFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file && file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      const id = addIntroLayer(5)
      updateLayer(id, { src: url } as any)
      const img = new Image()
      img.onload = () => {
        updateLayer(id, { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight })
      }
      img.src = url
    }
    // If no file selected, do nothing — don't create a blank intro layer
  }

  const handleOutroFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    const dur = audioDuration ?? 60
    if (file && file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      const id = addOutroLayer(dur, 5)
      updateLayer(id, { src: url } as any)
      const img = new Image()
      img.onload = () => {
        updateLayer(id, { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight })
      }
      img.src = url
    }
    // If no file selected, do nothing — don't create a blank outro layer
  }

  const handleSaveTemplate = async () => {
    if (layers.length === 0) return
    setSavingTemplate(true)
    setTemplateError(null)
    try {
      const name = window.prompt('Tên template:', `Template ${new Date().toLocaleDateString()}`)
      if (name != null) await saveTemplate(name, layers)
    } catch (e) {
      setTemplateError(e instanceof Error ? e.message : 'Không thể lưu template')
    } finally {
      setSavingTemplate(false)
    }
  }

  const handleLoadTemplate = (id: string) => {
    const loaded = loadTemplate(id)
    if (loaded) applyTemplateLayers(loaded)
    setShowTemplates(false)
  }

  return (
    <div style={panelStyle}>
      {/* ── Action buttons row ── */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        <button type="button" onClick={handleAddImage} style={addBtn('rgba(30,80,50,0.4)')} title="Thêm layer ảnh">
          🖼️ Ảnh
        </button>
        <button type="button" onClick={() => addTextLayer()} style={addBtn('rgba(60,60,20,0.4)')} title="Thêm layer chữ">
          📝 Text
        </button>
        <button type="button" onClick={() => addVisualizerLayer()} style={addBtn('rgba(20,40,80,0.4)')} title="Thêm sóng nhạc">
          🎵 Wave
        </button>
        <button type="button" onClick={() => videoInputRef.current?.click()} style={addBtn('rgba(60,20,60,0.4)')} title="Thêm video">
          🎬 Video
        </button>
        <button type="button" onClick={() => logoInputRef.current?.click()} style={addBtn('rgba(20,60,60,0.4)')} title="Thêm logo / watermark (luôn trên cùng)">
          💎 Logo
        </button>
        <button type="button" onClick={() => introInputRef.current?.click()} style={addBtn('rgba(50,30,10,0.4)')} title="Thêm intro layer (5 giây đầu)">
          🎬 Intro
        </button>
        <button type="button" onClick={() => outroInputRef.current?.click()} style={addBtn('rgba(50,10,30,0.4)')} title="Thêm outro layer (5 giây cuối)">
          🏁 Outro
        </button>
        <button type="button" onClick={() => addGroup()} style={addBtn()} title="Tạo group">
          📁 Group
        </button>
      </div>

      {/* ── Quick Presets ── */}
      <div style={{ padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            onClick={() => setShowPresets(!showPresets)}
            style={{
              ...addBtn('rgba(77,159,255,0.1)'),
              flex: 1,
              border: `1px solid ${showPresets ? 'rgba(77,159,255,0.4)' : 'rgba(255,255,255,0.1)'}`,
              color: showPresets ? '#a8d4ff' : 'rgba(255,255,255,0.7)',
            }}
          >
            🎨 Preset sóng {showPresets ? '▲' : '▼'}
          </button>
          <button
            type="button"
            onClick={() => setShowTemplates(!showTemplates)}
            style={{
              ...addBtn(),
              border: `1px solid ${showTemplates ? 'rgba(255,200,100,0.4)' : 'rgba(255,255,255,0.1)'}`,
              color: showTemplates ? 'rgba(255,220,150,0.9)' : 'rgba(255,255,255,0.7)',
            }}
          >
            📂 Template {showTemplates ? '▲' : '▼'}
          </button>
        </div>

        {/* Preset list */}
        {showPresets && (
          <div style={{
            marginTop: 6,
            maxHeight: 200,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            background: 'rgba(0,0,0,0.2)',
            borderRadius: 5,
            padding: 6,
          }}>
            {BUILT_IN_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  // Single undo step for entire preset application
                  pushHistorySnapshot(layers)
                  for (const layer of preset.layers) {
                    const id = addVisualizerLayer(layer.name, (layer as any).waveStyle)
                    updateLayer(id, { ...(layer as any), id })
                  }
                  setShowPresets(false)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '5px 8px',
                  fontSize: 10,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 4,
                  color: 'rgba(255,255,255,0.8)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
                title={preset.description}
              >
                <span style={{ fontSize: 14 }}>🎵</span>
                <span>
                  <span style={{ fontWeight: 600 }}>{preset.name}</span>
                  <span style={{ color: 'rgba(255,255,255,0.35)', marginLeft: 6 }}>[{preset.category}]</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Template panel */}
        {showTemplates && (
          <div style={{ marginTop: 6, background: 'rgba(0,0,0,0.2)', borderRadius: 5, padding: 6 }}>
            {templateError && (
              <div style={{ fontSize: 10, color: 'rgba(255,150,100,0.9)', marginBottom: 6, padding: '4px 6px', background: 'rgba(255,100,80,0.1)', borderRadius: 4 }}>
                ⚠️ {templateError}
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              <button
                type="button"
                onClick={handleSaveTemplate}
                disabled={layers.length === 0 || savingTemplate}
                style={{ ...addBtn('rgba(255,200,100,0.1)'), opacity: layers.length === 0 ? 0.5 : 1 }}
              >
                {savingTemplate ? '…' : '💾 Lưu'}
              </button>
              {templates.map((t) => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <button type="button" onClick={() => handleLoadTemplate(t.id)} style={addBtn()} title={`Load: ${t.name} (${t.layers.length} layers)`}>
                    {t.name}
                  </button>
                  <button type="button" onClick={() => deleteTemplate(t.id)} style={{ ...iconBtn, padding: '2px 4px', color: 'rgba(255,100,100,0.8)' }} title="Xóa">
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Layer list ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px' }}>
        {displayOrder.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🎵</div>
            Chưa có layer.<br />Thêm Ảnh, Text hoặc Wave để bắt đầu.
          </div>
        ) : (
          displayOrder.map((layer, rootIdx) => {
            if (isSongNhacGroupLayer(layer)) {
              const group = layer as SongNhacGroupLayer
              const isExpanded = expandedGroupIds[group.id] === true || editingGroupId === group.id
              const isEditing = editingGroupId === group.id
              // FIX: displayOrder is reversed, so rootIdx=0 is visually top (= last in layers array)
              // canMoveUp means move towards display-top (= higher index in layers), which is moveLayerUp
              const canMoveUp = rootIdx > 0         // has something above in displayOrder
              const canMoveDown = rootIdx < displayOrder.length - 1  // has something below
              const childLayers = group.children
                .map((id) => layers.find((l) => l.id === id))
                .filter((l): l is SongNhacLayer => !!l && !isSongNhacGroupLayer(l))
              return (
                <div key={group.id} style={{ marginBottom: 2 }}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => setSelection(group.id, { ctrlKey: e.ctrlKey, shiftKey: e.shiftKey })}
                    onDoubleClick={() => isEditing ? setEditingGroupId(null) : setEditingGroupId(group.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelection(group.id) } }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '5px 8px', borderRadius: 5,
                      background: selectedIds.includes(group.id) ? 'rgba(77,159,255,0.15)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${selectedIds.includes(group.id) ? 'rgba(77,159,255,0.4)' : 'rgba(255,255,255,0.07)'}`,
                      cursor: 'pointer', fontSize: 11, color: 'rgba(255,255,255,0.85)',
                    }}
                  >
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleGroupExpanded(group.id) }} style={{ ...iconBtn, padding: '1px 3px', fontSize: 9 }}>
                      {isExpanded ? '▼' : '▶'}
                    </button>
                    <span style={{ fontSize: 13 }}>📁</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {group.name} <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>({group.children.length})</span>
                    </span>
                    {isEditing && <span style={{ fontSize: 9, color: '#4d9fff' }}>✏️ Đang sửa</span>}
                    <button type="button" onClick={(e) => { e.stopPropagation(); moveLayerUp(group.id) }} disabled={!canMoveUp} title="Lên trên" style={{ ...iconBtn, opacity: canMoveUp ? 1 : 0.3 }}>↑</button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); moveLayerDown(group.id) }} disabled={!canMoveDown} title="Xuống dưới" style={{ ...iconBtn, opacity: canMoveDown ? 1 : 0.3 }}>↓</button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); removeLayer(group.id) }} title="Xóa" style={{ ...iconBtn, color: 'rgba(255,100,100,0.8)' }}>🗑</button>
                  </div>
                  {isExpanded && childLayers.map((child, idx) => {
                    const isFirst = idx === 0
                    const isLast = idx === childLayers.length - 1
                    return (
                      <div key={child.id} style={{ marginLeft: 14, marginTop: 2 }}>
                        <LayerRow
                          layer={child}
                          isSelected={selectedIds.includes(child.id)}
                          canMoveUp={isEditing && !isFirst}
                          canMoveDown={isEditing && !isLast}
                          onSelect={(ev) => setSelection(child.id, { ctrlKey: ev?.ctrlKey, shiftKey: ev?.shiftKey })}
                          onRemove={() => removeLayer(child.id)}
                          onMoveUp={() => moveLayerInGroup(group.id, idx, idx - 1)}
                          onMoveDown={() => moveLayerInGroup(group.id, idx, idx + 1)}
                          onToggleVisible={() => updateLayer(child.id, { visible: !child.visible })}
                          onToggleLocked={() => updateLayerWithHistory(child.id, { locked: !child.locked })}
                          onAddToGroup={undefined}
                          onRemoveFromGroup={() => removeFromGroup(child.id)}
                          groups={layers.filter((l) => isSongNhacGroupLayer(l)) as SongNhacGroupLayer[]}
                          addToGroupLayerId={addToGroupLayerId}
                          setAddToGroupLayerId={setAddToGroupLayerId}
                        />
                      </div>
                    )
                  })}
                </div>
              )
            }

            // Root layer:
            // displayOrder[0] = top of visual stack (last in layers array)
            // moveLayerUp on layer at layers[N-1] moves it to front (already there) — DISABLED
            // The ▲ button should move layer towards display top (higher z), which = moveLayerUp in store
            // FIX: rootIdx=0 is visually topmost; can't go higher
            const canMoveUp = rootIdx > 0
            const canMoveDown = rootIdx < displayOrder.length - 1
            return (
              <div key={layer.id} style={{ marginBottom: 2 }}>
                <LayerRow
                  layer={layer}
                  isSelected={selectedIds.includes(layer.id)}
                  canMoveUp={canMoveUp}
                  canMoveDown={canMoveDown}
                  onSelect={(ev) => setSelection(layer.id, { ctrlKey: ev?.ctrlKey, shiftKey: ev?.shiftKey })}
                  onRemove={() => removeLayer(layer.id)}
                  onMoveUp={() => moveLayerUp(layer.id)}
                  onMoveDown={() => moveLayerDown(layer.id)}
                  onToggleVisible={() => updateLayer(layer.id, { visible: !layer.visible })}
                  onToggleLocked={() => updateLayerWithHistory(layer.id, { locked: !layer.locked })}
                  onAddToGroup={(gid) => addLayerToGroup(layer.id, gid)}
                  onRemoveFromGroup={undefined}
                  groups={layers.filter((l) => isSongNhacGroupLayer(l)) as SongNhacGroupLayer[]}
                  addToGroupLayerId={addToGroupLayerId}
                  setAddToGroupLayerId={setAddToGroupLayerId}
                />
              </div>
            )
          })
        )}
      </div>

      {/* Hidden file inputs */}
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageFileChange} />
      <input ref={logoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoFileChange} />
      <input ref={introInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleIntroFileChange} />
      <input ref={outroInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleOutroFileChange} />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file && file.type.startsWith('video/')) {
            const url = URL.createObjectURL(file)
            const id = addVideoLayer(undefined, url)
            const vid = document.createElement('video')
            vid.onloadedmetadata = () => {
              updateLayer(id, { naturalWidth: vid.videoWidth, naturalHeight: vid.videoHeight })
              // Release the temporary element — the render cache manages the real video
              vid.src = ''
              vid.load()
            }
            vid.src = url
          }
        }}
      />
    </div>
  )
}

function LayerRow({
  layer,
  isSelected,
  canMoveUp,
  canMoveDown,
  onSelect,
  onRemove,
  onMoveUp,
  onMoveDown,
  onToggleVisible,
  onToggleLocked,
  onAddToGroup,
  onRemoveFromGroup,
  groups,
  addToGroupLayerId,
  setAddToGroupLayerId,
}: {
  layer: SongNhacLayer
  isSelected: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onSelect: (ev?: React.MouseEvent) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onToggleVisible: () => void
  onToggleLocked: () => void
  onAddToGroup?: (groupId: string) => void
  onRemoveFromGroup?: () => void
  groups: SongNhacGroupLayer[]
  addToGroupLayerId: string | null
  setAddToGroupLayerId: (id: string | null) => void
}) {
  const isImage = isSongNhacImageLayer(layer)
  const isViz = isSongNhacVisualizerLayer(layer)
  const isVid = isSongNhacVideoLayer(layer)
  const typeIcon = LAYER_TYPE_ICON[layer.type] ?? '📄'
  const typeBg = LAYER_TYPE_COLOR[layer.type] ?? '#1a1a2e'

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 8px',
        borderRadius: 5,
        background: isSelected ? 'rgba(77,159,255,0.15)' : `${typeBg}55`,
        border: `1px solid ${isSelected ? 'rgba(77,159,255,0.4)' : 'rgba(255,255,255,0.07)'}`,
        cursor: 'pointer',
        fontSize: 11,
        color: 'rgba(255,255,255,0.85)',
        opacity: layer.visible ? 1 : 0.5,
        transition: 'background 0.1s, border-color 0.1s',
      }}
    >
      {/* Thumbnail / icon */}
      <span style={{ flexShrink: 0 }}>
        {isImage && layer.src ? (
          <img
            src={layer.src}
            alt=""
            style={{ width: 26, height: 26, objectFit: 'cover', borderRadius: 3, background: 'rgba(0,0,0,0.3)', display: 'block' }}
          />
        ) : (
          <span style={{ fontSize: 15, display: 'block', lineHeight: 1, padding: '2px 0' }}>{typeIcon}</span>
        )}
      </span>

      {/* Name */}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
        {layer.name}
        {isViz && (
          <span style={{ marginLeft: 5, fontSize: 9, color: 'rgba(100,160,255,0.7)', fontStyle: 'italic' }}>
            {(layer as any).waveStyle ?? 'wave'}
          </span>
        )}
        {/* Badges */}
        {(layer as any).role === 'watermark' && (
          <span style={{ marginLeft: 4, fontSize: 9, padding: '1px 4px', borderRadius: 3, background: 'rgba(0,200,200,0.15)', color: '#00dddd', border: '1px solid rgba(0,200,200,0.3)' }}>
            💎 Logo
          </span>
        )}
        {(layer as any).timeRange && (() => {
          const tr = (layer as any).timeRange as { startSec: number; endSec: number }
          return (
            <span style={{ marginLeft: 4, fontSize: 9, padding: '1px 4px', borderRadius: 3, background: 'rgba(255,160,0,0.12)', color: '#ffaa44', border: '1px solid rgba(255,160,0,0.25)', whiteSpace: 'nowrap' }}>
              ⏱ {tr.startSec.toFixed(0)}s→{tr.endSec.toFixed(0)}s
            </span>
          )
        })()}
      </span>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onToggleLocked} title={layer.locked ? 'Mở khóa' : 'Khóa'} style={{ ...iconBtn, opacity: layer.locked ? 1 : 0.45, padding: '2px 4px', fontSize: 10 }}>
          {layer.locked ? '🔒' : '🔓'}
        </button>
        <button type="button" onClick={onToggleVisible} title={layer.visible ? 'Ẩn' : 'Hiện'} style={{ ...iconBtn, opacity: layer.visible ? 1 : 0.45, padding: '2px 4px', fontSize: 10 }}>
          {layer.visible ? '👁' : '🚫'}
        </button>
        <button type="button" onClick={onMoveUp} disabled={!canMoveUp} title="Lên trên" style={{ ...iconBtn, opacity: canMoveUp ? 1 : 0.25 }}>↑</button>
        <button type="button" onClick={onMoveDown} disabled={!canMoveDown} title="Xuống dưới" style={{ ...iconBtn, opacity: canMoveDown ? 1 : 0.25 }}>↓</button>

        {onRemoveFromGroup && (
          <button type="button" onClick={onRemoveFromGroup} title="Ra khỏi group" style={iconBtn}>↩</button>
        )}

        {groups.length > 0 && onAddToGroup && (
          <div style={{ position: 'relative' }} data-add-to-group="true">
            <button type="button" onClick={() => setAddToGroupLayerId(addToGroupLayerId === layer.id ? null : layer.id)} title="Vào group" style={iconBtn}>
              ＋
            </button>
            {addToGroupLayerId === layer.id && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 2,
                background: '#1e1e3a', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 5, padding: 4, zIndex: 100, minWidth: 130,
              }}>
                {groups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => { onAddToGroup(g.id); setAddToGroupLayerId(null) }}
                    style={{ display: 'block', width: '100%', padding: '4px 8px', textAlign: 'left', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.85)', cursor: 'pointer', fontSize: 11, borderRadius: 3 }}
                  >
                    📁 {g.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button type="button" onClick={onRemove} title="Xóa" style={{ ...iconBtn, color: 'rgba(255,100,100,0.8)', padding: '2px 5px' }}>
          🗑
        </button>
      </div>
    </div>
  )
}
