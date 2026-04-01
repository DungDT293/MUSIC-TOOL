import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import ScanMusicPage from './pages/Music/ScanMusicPage'
import CreatePlaylistPage from './pages/Music/CreatePlaylistPage'
import PreviewPlaylistPage from './pages/Music/PreviewPlaylistPage'
import ExportAudioPage from './pages/Music/ExportAudioPage'
import SongNhacPage from './pages/Music/SongNhacPage'
import VideoToolsPage from './pages/Video/VideoToolsPage'
import CutMergeVideoPage from './pages/Video/CutMergeVideoPage'
import FinalExportTab from './pages/Video/FinalExportTab'
import YouTubeDownloaderTab from './pages/Video/YouTubeDownloaderTab'
import EnhanceAudioPage from './pages/Music/EnhanceAudioPage'
import { HIDE_FEATURE_AUTOPILOT } from './config/featureFlags'
import AutopilotPage from './pages/AutopilotPage'
import SettingsPage from './pages/SettingsPage'
import { ErrorBoundary } from './components/ErrorBoundary'

/**
 * Router với keep-alive cho tất cả pages.
 *
 * Tất cả pages dùng `display: none` thay vì unmount khi chuyển tab.
 * Điều này giữ nguyên toàn bộ state, settings, form data khi chuyển qua lại.
 *
 * Lazy-mount: mỗi page chỉ mount khi user vào lần đầu tiên.
 */

interface KeepAlivePage {
  path: string
  component: React.ComponentType
  redirectTo?: string // for redirect-only routes
}

// Module-scope constant — derived from compile-time flag, safe to hoist out of component
// This prevents stale closure in useEffect dependency array
const KEEP_ALIVE_PAGES: KeepAlivePage[] = [
  { path: '/music/scan', component: ScanMusicPage },
  { path: '/music/playlist', component: CreatePlaylistPage },
  { path: '/music/preview', component: PreviewPlaylistPage },
  { path: '/music/export', component: ExportAudioPage },
  { path: '/music/song-nhac', component: SongNhacPage },
  { path: '/video/tools', component: VideoToolsPage },
  { path: '/video/cut-merge', component: CutMergeVideoPage },
  { path: '/video/final-export', component: FinalExportTab },
  { path: '/video/youtube-downloader', component: YouTubeDownloaderTab },
  { path: '/music/enhance', component: EnhanceAudioPage },
  ...(!HIDE_FEATURE_AUTOPILOT ? [{ path: '/autopilot', component: AutopilotPage }] : []),
  { path: '/settings', component: SettingsPage },
]

function Router() {
  const location = useLocation()
  const currentPath = location.pathname

  // Track mounted pages — lazy mount (chỉ mount khi user vào lần đầu)
  const [mountedPaths, setMountedPaths] = useState<Set<string>>(() => {
    // Mount current page ngay lập tức
    const initial = new Set<string>()
    const match = KEEP_ALIVE_PAGES.find(p => p.path === currentPath)
    if (match) initial.add(match.path)
    else initial.add('/music/scan') // default
    return initial
  })

  useEffect(() => {
    const match = KEEP_ALIVE_PAGES.find(p => p.path === currentPath)
    if (match && !mountedPaths.has(match.path)) {
      setMountedPaths(prev => new Set(prev).add(match.path))
    }
  }, [currentPath, mountedPaths])

  return (
    <>
      {/* Redirect cho root path */}
      {currentPath === '/' && <Navigate to="/music/scan" replace />}

      {/* Keep-alive: tất cả pages luôn mounted sau lần đầu, chỉ ẩn/hiện bằng CSS */}
      {KEEP_ALIVE_PAGES.map(({ path, component: Component }) => {
        if (!mountedPaths.has(path)) return null
        const isActive = currentPath === path
        return (
          <div key={path} style={{ display: isActive ? 'block' : 'none', height: '100%' }}>
            <ErrorBoundary key={path}>
              <Component />
            </ErrorBoundary>
          </div>
        )
      })}

      {/* Fallback routes cho các path không match */}
      {!KEEP_ALIVE_PAGES.some(p => p.path === currentPath) && currentPath !== '/' && (
        <Routes>
          <Route path="/music/visualizer-v2" element={<Navigate to="/music/scan" replace />} />
          <Route path="/visualizer-v2-demo" element={<Navigate to="/music/scan" replace />} />
          <Route path="*" element={<Navigate to="/music/scan" replace />} />
        </Routes>
      )}
    </>
  )
}

export default Router
