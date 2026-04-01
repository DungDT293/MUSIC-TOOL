import React, { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error)
    console.error('[ErrorBoundary] Error info:', errorInfo)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div
          style={{
            padding: '40px',
            color: '#ef4444',
            fontFamily: 'system-ui, sans-serif',
            backgroundColor: '#1e1e1e',
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '20px',
          }}
        >
          <h1 style={{ fontSize: '24px', margin: 0 }}>Đã xảy ra lỗi</h1>
          <div
            style={{
              backgroundColor: '#2a2a2a',
              padding: '20px',
              borderRadius: '8px',
              maxWidth: '600px',
              width: '100%',
            }}
          >
            <p>
              <strong>Lỗi:</strong> {this.state.error?.message || 'Unknown error'}
            </p>
            {this.state.error?.stack && import.meta.env.DEV && (
              <details style={{ marginTop: '10px' }}>
                <summary style={{ cursor: 'pointer', color: '#9ca3af' }}>Chi tiết lỗi</summary>
                <pre
                  style={{
                    marginTop: '10px',
                    padding: '10px',
                    background: '#1a1a1a',
                    borderRadius: '4px',
                    overflow: 'auto',
                    fontSize: '12px',
                    color: '#ef4444',
                  }}
                >
                  {this.state.error.stack}
                </pre>
              </details>
            )}
          </div>
          <button
            onClick={() => {
              // Reload only — setState is unnecessary because reload resets all state
              window.location.reload()
            }}
            style={{
              padding: '10px 20px',
              background: '#3b82f6',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 600,
            }}
          >
            Tải lại trang
          </button>
        </div>
      )
    }

    return this.props.children
  }
}













