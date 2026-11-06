import { NavLink, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import './Sidebar.css'

declare const window: Window & { api?: { app?: { getVersion?: () => Promise<string> } } }

interface SidebarProps {
  isCollapsed: boolean
  onToggle: () => void
}

interface MenuItem {
  path: string
  number: string
  label: string
}

import { HIDE_FEATURE_AUTOPILOT } from '../config/featureFlags'

// Thứ tự: 1–8, (9 Autopilot ẩn), 9 Cài đặt
const allMenuItems: (MenuItem & { hidden?: boolean })[] = [
  { path: '/music/scan', number: '1', label: 'Quét nhạc' },
  { path: '/music/playlist', number: '2', label: 'Tạo playlist' },
  { path: '/music/preview', number: '3', label: 'Nghe thử playlist' },
  { path: '/music/export', number: '4', label: 'Xuất nhạc' },
  { path: '/music/mp4-to-audio', number: '5', label: 'MP4 → Audio' },
  { path: '/music/song-nhac', number: '5', label: 'Sóng nhạc' },
  { path: '/video/cut-merge', number: '6', label: 'Cắt/Ghép video' },
  { path: '/video/final-export', number: '6', label: 'Xuất video hoàn chỉnh' },
  { path: '/video/youtube-downloader', number: '7', label: 'YouTube Downloader' },
  { path: '/music/enhance', number: '8', label: 'Nâng cấp âm thanh' },
  { path: '/autopilot', number: '9', label: 'Autopilot', hidden: HIDE_FEATURE_AUTOPILOT },
  { path: '/settings', number: '10', label: 'Cài đặt' },
]

// Lọc item ẩn và sắp xếp lại ID tuần tự (1–11 khi Autopilot ẩn)
const menuItems: MenuItem[] = (() => {
  const visible = allMenuItems.filter((item) => !item.hidden)
  return visible.map((item, idx) => ({ path: item.path, number: String(idx + 1), label: item.label }))
})()

function Sidebar({ isCollapsed, onToggle }: SidebarProps) {
  const location = useLocation()
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null)
  const [appVersion, setAppVersion] = useState<string>('')

  useEffect(() => {
    window.api?.app?.getVersion?.().then(setAppVersion).catch(() => {})
  }, [])

  const handleNavClick = (_path: string) => {
    // Navigation click — no logging in production
  }

  const handleMouseEnter = (e: React.MouseEvent<HTMLAnchorElement>, item: MenuItem) => {
    if (isCollapsed) {
      setHoveredItem(item.number)
      const rect = e.currentTarget.getBoundingClientRect()
      setTooltipPosition({
        x: rect.right + 10,
        y: rect.top + rect.height / 2,
      })
    }
  }

  const handleMouseLeave = () => {
    setHoveredItem(null)
    setTooltipPosition(null)
  }

  return (
    <aside
      style={{
        width: isCollapsed ? '72px' : '250px',
        backgroundColor: '#1e1e1e',
        color: '#fff',
        padding: isCollapsed ? '12px 8px' : '20px',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid #333',
        position: 'relative',
        zIndex: 1,
        transition: 'width 0.3s ease, padding 0.3s ease',
        overflow: 'visible',
        alignItems: isCollapsed ? 'center' : 'stretch',
      }}
    >
      {/* Toggle button */}
      <button
        onClick={onToggle}
        style={{
          position: 'absolute',
          top: isCollapsed ? '8px' : '12px',
          right: isCollapsed ? '8px' : '12px',
          background: '#2d2d2d',
          border: '1px solid #444',
          borderRadius: '6px',
          color: '#fff',
          cursor: 'pointer',
          padding: isCollapsed ? '4px 6px' : '6px 10px',
          fontSize: isCollapsed ? '14px' : '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
          transition: 'all 0.2s',
          width: isCollapsed ? '28px' : 'auto',
          height: isCollapsed ? '28px' : 'auto',
          minWidth: isCollapsed ? '28px' : '32px',
          minHeight: isCollapsed ? '28px' : '32px',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = '#3d3d3d'
          e.currentTarget.style.borderColor = '#555'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = '#2d2d2d'
          e.currentTarget.style.borderColor = '#444'
        }}
        title={isCollapsed ? 'Hiện menu' : 'Ẩn menu'}
      >
        {isCollapsed ? '☰' : '✕'}
      </button>

      {!isCollapsed && (
        <div style={{ marginBottom: '30px' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold', paddingRight: '40px' }}>
            93 Media - Tool Mix Nhạc {appVersion && <span style={{ fontSize: '14px', color: '#9ca3af', fontWeight: 'normal' }}>v{appVersion}</span>}
          </h2>
        </div>
      )}

      {/* Tooltip khi thu gọn */}
      {isCollapsed && hoveredItem && tooltipPosition && (
        <div
          style={{
            position: 'fixed',
            left: `${tooltipPosition.x}px`,
            top: `${tooltipPosition.y}px`,
            transform: 'translateY(-50%)',
            background: '#2d2d2d',
            color: '#fff',
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            zIndex: 10000,
            pointerEvents: 'none',
            border: '1px solid #444',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            animation: 'fadeIn 0.2s ease-in',
          }}
        >
          {menuItems.find((item) => item.number === hoveredItem)?.number}.{' '}
          {menuItems.find((item) => item.number === hoveredItem)?.label}
        </div>
      )}

      <nav
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: isCollapsed ? '14px' : '8px',
          position: 'relative',
          zIndex: 2,
          marginTop: isCollapsed ? '40px' : 0,
        }}
      >
        {menuItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={() => handleNavClick(item.path)}
            className={({ isActive }) => (isActive ? 'active' : '')}
            onMouseEnter={(e) => handleMouseEnter(e, item)}
            onMouseLeave={handleMouseLeave}
            style={({ isActive }) => {
              const base: React.CSSProperties = {
                textDecoration: 'none',
                transition: 'all 0.18s ease-out',
                cursor: 'pointer',
                position: 'relative',
                zIndex: 3,
                display: 'flex',
                alignItems: 'center',
                whiteSpace: 'nowrap',
                overflow: 'visible',
                boxSizing: 'border-box',
                flexShrink: 0,
              }

              if (isCollapsed) {
                const collapsedBase: React.CSSProperties = {
                  ...base,
                  padding: 0,
                  borderRadius: 999,
                  justifyContent: 'center',
                  height: 36,
                  width: 36,
                  minHeight: 36,
                  minWidth: 36,
                  maxWidth: 36,
                  fontSize: 14,
                  fontWeight: 700,
                  background: '#111827',
                  border: '2px solid #374151',
                  color: '#e5e7eb',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.6)',
                }

                if (isActive) {
                  return {
                    ...collapsedBase,
                    background: '#2563eb',
                    borderColor: '#60a5fa',
                    color: '#ffffff',
                    boxShadow: '0 0 0 2px rgba(96,165,250,0.6)',
                  }
                }

                return collapsedBase
              }

              const expandedBase: React.CSSProperties = {
                ...base,
                padding: '12px 16px',
                borderRadius: 6,
                justifyContent: 'flex-start',
                fontSize: 14,
                fontWeight: 400,
                color: '#ccc',
                background: 'transparent',
                border: 'none',
              }

              if (isActive) {
                return {
                  ...expandedBase,
                  background: '#007acc',
                  color: '#ffffff',
                }
              }

              return expandedBase
            }}
          >
            {isCollapsed ? item.number : `${item.number}. ${item.label}`}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}

export default Sidebar









