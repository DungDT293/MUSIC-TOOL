import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { ErrorBoundary } from './components/ErrorBoundary'

// Kiểm tra window.api trước khi render
if (typeof window !== 'undefined' && !(window as any).api) {
  console.error('[main.tsx] window.api is not available! Check preload script.')
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


