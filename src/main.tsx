import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { ErrorBoundary } from './components/ErrorBoundary'

// Kiểm tra window.api trước khi render
if (typeof window !== 'undefined' && !window.api) {
  console.error('[main.tsx] window.api is not available! Check preload script.')
}

// Electron's very first renderer in a fresh window can come up without WebCodecs
// (VideoEncoder/VideoDecoder undefined while VideoFrame exists); one reload restores
// them. Guarded by sessionStorage so an unsupported machine reloads at most once.
// The reload is deferred until after `load`: reloading mid-navigation rejects the
// loadURL promise in the main process with ERR_ABORTED and used to pop the boot-error
// dialog on top of a perfectly healthy app.
if (typeof window !== 'undefined') {
  const RELOAD_KEY = 'app.webcodecsReload'
  if (typeof (window as unknown as { VideoEncoder?: unknown }).VideoEncoder === 'undefined') {
    const maybeReload = () => {
      window.setTimeout(() => {
        if (typeof (window as unknown as { VideoEncoder?: unknown }).VideoEncoder !== 'undefined') return
        if (sessionStorage.getItem(RELOAD_KEY)) return
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
        window.location.reload()
      }, 600)
    }
    if (document.readyState === 'complete') maybeReload()
    else window.addEventListener('load', maybeReload, { once: true })
  } else {
    sessionStorage.removeItem(RELOAD_KEY)
  }
}

try {
  const rootElement = document.getElementById('root')
  if (!rootElement) {
    throw new Error('Root element not found!')
  }

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  )
} catch (error) {
  console.error('[main.tsx] Failed to render app:', error)
  
  // Safe DOM manipulation to prevent XSS
  const errorDiv = document.createElement('div')
  errorDiv.style.cssText = 'padding: 20px; color: red; font-family: monospace;'
  
  const h1 = document.createElement('h1')
  h1.textContent = 'Error loading app'
  errorDiv.appendChild(h1)
  
  const pre = document.createElement('pre')
  pre.textContent = error instanceof Error ? error.message : String(error)
  errorDiv.appendChild(pre)
  
  const p = document.createElement('p')
  p.textContent = 'Check console for details.'
  errorDiv.appendChild(p)
  
  document.body.appendChild(errorDiv)
}


