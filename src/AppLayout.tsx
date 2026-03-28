import { ReactNode, useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import TopBarStats from './components/TopBarStats'

interface AppLayoutProps {
  children: ReactNode
}

function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation()
  const isVisualizerPage = location.pathname === '/music/song-nhac'
  
  // Load sidebar collapsed state from localStorage
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebarCollapsed')
    return saved === 'true'
  })

  // Save to localStorage when state changes
  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', String(isSidebarCollapsed))
  }, [isSidebarCollapsed])

  const toggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed)
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', backgroundColor: '#1e1e1e', position: 'relative' }}>
      <Sidebar isCollapsed={isSidebarCollapsed} onToggle={toggleSidebar} />
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', position: 'relative', zIndex: 0 }}>
        {!isVisualizerPage && <TopBarStats />}
        <main style={{ flex: 1, overflow: isVisualizerPage ? 'hidden' : 'auto', padding: isVisualizerPage ? '0' : '20px', backgroundColor: '#1e1e1e', position: 'relative', zIndex: 0 }}>
          {/* Toggle button khi sidebar bị ẩn */}
          {isSidebarCollapsed && (
            <button
              onClick={toggleSidebar}
              style={{
                position: 'fixed',
                top: '80px',
                left: '8px',
                background: '#2d2d2d',
                border: '1px solid #444',
                borderRadius: '6px',
                color: '#fff',
                cursor: 'pointer',
                padding: '8px 12px',
                fontSize: '18px',
                zIndex: 1000,
                transition: 'all 0.2s',
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#3d3d3d'
                e.currentTarget.style.borderColor = '#555'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#2d2d2d'
                e.currentTarget.style.borderColor = '#444'
              }}
              title="Hiện menu"
            >
              ☰
            </button>
          )}
          {children}
        </main>
      </div>
      {/* Footer với logo và credit */}
      <div
        style={{
          position: 'fixed',
          bottom: '8px',
          left: isSidebarCollapsed ? '72px' : '250px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          zIndex: 1000,
          opacity: 0.7,
          transition: 'opacity 0.2s, left 0.3s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.opacity = '1'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = '0.7'
        }}
      >
        <img
          src="/assets/Gemini_Generated_Image_mord6dmord6dmord.png"
          alt="LeonYG Logo"
          style={{
            width: '24px',
            height: '24px',
            objectFit: 'contain',
          }}
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />
        <span
          style={{
            fontSize: '11px',
            color: '#9f9f9f',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          Created by LeonYG
        </span>
      </div>
    </div>
  )
}

export default AppLayout



