import React from 'react'

interface DiskSpaceErrorModalProps {
  error: string | null
  onClose: () => void
}

export function DiskSpaceErrorModal({ error, onClose }: DiskSpaceErrorModalProps) {
  if (!error) return null

  return (
    <>
      {/* Backdrop — intentionally non-dismissible (MED-08): disk space error requires explicit action */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          zIndex: 9998,
          backdropFilter: 'blur(4px)',
        }}
      />

      {/* Modal */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 9999,
          backgroundColor: '#1a1a1a',
          border: '3px solid #cc0000',
          borderRadius: '12px',
          padding: '24px',
          maxWidth: '700px',
          width: '90%',
          maxHeight: '85vh',
          overflow: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '20px',
            paddingBottom: '16px',
            borderBottom: '2px solid #333',
          }}
        >
          <h2
            style={{
              margin: 0,
              color: '#ff6666',
              fontSize: '24px',
              fontWeight: 'bold',
            }}
          >
            Cảnh báo dung lượng ổ đĩa
          </h2>
        </div>

        {/* Message */}
        <div
          style={{
            color: '#ddd',
            fontSize: '14px',
            lineHeight: '1.8',
            whiteSpace: 'pre-line',
            fontFamily: 'Consolas, "Courier New", monospace',
            backgroundColor: '#0a0a0a',
            padding: '20px',
            borderRadius: '8px',
            border: '1px solid #222',
            marginBottom: '20px',
            maxHeight: '500px',
            overflow: 'auto',
          }}
        >
          {error}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '12px',
            paddingTop: '16px',
            borderTop: '2px solid #333',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '10px 24px',
              fontSize: '15px',
              fontWeight: 'bold',
              backgroundColor: '#cc0000',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              transition: 'background-color 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#ff0000'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#cc0000'
            }}
          >
            Đã hiểu
          </button>
        </div>
      </div>
    </>
  )
}
