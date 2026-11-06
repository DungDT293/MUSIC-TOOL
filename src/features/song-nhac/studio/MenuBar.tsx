import { useEffect, useRef, useState } from 'react'

export interface MenuBarActions {
  saveProject: () => void
  openProject: () => void
  newProject: () => void
  exportVideo: () => void
  undo: () => void
  redo: () => void
  duplicate: () => void
  removeSelected: () => void
  copy: () => void
  paste: () => void
  setResolution: (width: number, height: number) => void
  toggleSnap: () => void
  resetTimelineZoom: () => void
  showShortcuts: () => void
  showAbout: () => void
}

interface MenuItem {
  label: string
  hint?: string
  action?: () => void
  separator?: boolean
}

const BAR_HEIGHT = 30

/**
 * Top menu bar mirroring the reference editor's File / Edit / Project / View / Help.
 * Menus open on click, switch on hover once open, and close on Escape or outside click.
 */
export function MenuBar({ actions }: { actions: MenuBarActions }) {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!openMenu) return
    const onPointerDown = (event: PointerEvent) => {
      if (barRef.current && !barRef.current.contains(event.target as Node)) setOpenMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [openMenu])

  const menus: Record<string, MenuItem[]> = {
    File: [
      { label: 'Xuất video…', hint: 'Ctrl+E', action: actions.exportVideo },
      { separator: true, label: '' },
      { label: 'Lưu project', hint: 'Ctrl+S', action: actions.saveProject },
      { label: 'Mở project…', action: actions.openProject },
      { label: 'Project mới', action: actions.newProject },
    ],
    Edit: [
      { label: 'Hoàn tác', hint: 'Ctrl+Z', action: actions.undo },
      { label: 'Làm lại', hint: 'Ctrl+Shift+Z', action: actions.redo },
      { separator: true, label: '' },
      { label: 'Sao chép', hint: 'Ctrl+C', action: actions.copy },
      { label: 'Dán', hint: 'Ctrl+V', action: actions.paste },
      { label: 'Nhân bản', hint: 'Ctrl+D', action: actions.duplicate },
      { label: 'Xoá lớp đang chọn', hint: 'Delete', action: actions.removeSelected },
    ],
    Project: [
      { label: 'Độ phân giải 1080p', action: () => actions.setResolution(1920, 1080) },
      { label: 'Độ phân giải 4K', action: () => actions.setResolution(3840, 2160) },
      { label: 'Shorts 9:16', action: () => actions.setResolution(1080, 1920) },
      { separator: true, label: '' },
      { label: 'Bật/tắt bắt dính (snap)', hint: 'S', action: actions.toggleSnap },
    ],
    View: [
      { label: 'Thu nhỏ timeline (1x)', action: actions.resetTimelineZoom },
      { label: 'Bật/tắt bắt dính (snap)', action: actions.toggleSnap },
    ],
    Help: [
      { label: 'Phím tắt', action: actions.showShortcuts },
      { label: 'Thông tin phiên bản', action: actions.showAbout },
    ],
  }

  return (
    <div
      ref={barRef}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        height: BAR_HEIGHT,
        marginBottom: 8,
        padding: '0 6px',
        borderRadius: 8,
        border: '1px solid #1e293b',
        background: '#0b1220',
        fontSize: 12,
        color: '#cbd5e1',
      }}
    >
      {Object.entries(menus).map(([name, items]) => (
        <div key={name} style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setOpenMenu(openMenu === name ? null : name)}
            onMouseEnter={() => {
              if (openMenu) setOpenMenu(name)
            }}
            style={{
              padding: '3px 10px',
              borderRadius: 6,
              border: 'none',
              background: openMenu === name ? '#16233b' : 'transparent',
              color: openMenu === name ? '#e2e8f0' : '#cbd5e1',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {name}
          </button>
          {openMenu === name && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                zIndex: 1500,
                minWidth: 220,
                padding: 4,
                marginTop: 4,
                borderRadius: 8,
                border: '1px solid #1e293b',
                background: '#0b1220',
                boxShadow: '0 12px 30px rgba(0, 0, 0, 0.55)',
              }}
            >
              {items.map((item, index) =>
                item.separator ? (
                  <div key={`sep-${index}`} style={{ height: 1, margin: '4px 6px', background: '#1e293b' }} />
                ) : (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      setOpenMenu(null)
                      item.action?.()
                    }}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 18,
                      width: '100%',
                      padding: '5px 8px',
                      border: 'none',
                      borderRadius: 6,
                      background: 'transparent',
                      color: '#e2e8f0',
                      fontSize: 12,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.background = '#16233b'
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <span>{item.label}</span>
                    {item.hint && <span style={{ color: '#64748b', fontSize: 11 }}>{item.hint}</span>}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
